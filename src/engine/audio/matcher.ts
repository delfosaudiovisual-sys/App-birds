import { ALL_SPECIES } from '../../data/species';
import { contextWeight, type FieldContext } from '../../data/occurrence';
import type { Range, Species } from '../../data/types';
import { clamp01, resample, type AcousticFeatures } from './features';
import { blendWithExemplar, matchExemplars, type Exemplar } from './exemplars';

export interface SpeciesMatch {
  species: Species;
  /** 0-1, probabilidade normalizada entre os candidatos */
  probability: number;
  /** 0-1, aderencia bruta ao perfil da especie (antes do softmax) */
  fit: number;
  /** o que puxou a favor e o que puxou contra */
  reasons: { label: string; ok: boolean; detail: string }[];
}

export interface MatchResult {
  matches: SpeciesMatch[];
  /** 0-1: confianca de que o topo esta certo */
  confidence: number;
  /** true quando nada na base cobre o que foi gravado */
  inconclusive: boolean;
  notes: string[];
}

/**
 * Pontua um valor contra a faixa declarada pela especie.
 *
 * O patamar (1.0 em qualquer ponto dentro da faixa) parece grosseiro e chegou a
 * ser trocado por uma verossimilhanca gaussiana centrada na faixa — que MEDIU
 * PIOR na bancada: 11% contra 21% de acerto no primeiro palpite. A razao e que
 * as faixas descrevem variacao real da especie, nao incerteza em torno de um
 * valor tipico. Uma corruira canta em qualquer ponto entre 3 e 7 kHz, e
 * penalizar 6.9 kHz por "estar longe do centro" inventa uma preferencia que a
 * ave nao tem. Fora da faixa, a queda e proporcional a largura dela.
 */
function rangeScore(value: number, [lo, hi]: Range, tolerance = 0.6): number {
  if (value >= lo && value <= hi) return 1;
  const width = Math.max(hi - lo, 1e-6);
  const d = value < lo ? lo - value : value - hi;
  return clamp01(1 - d / (width * tolerance + 1e-6));
}

/** Igual, em oitavas: a percepcao de altura e logaritmica. */
function logRangeScore(value: number, [lo, hi]: Range, toleranceOctaves = 0.7): number {
  if (value <= 0) return 0;
  if (value >= lo && value <= hi) return 1;
  const ref = value < lo ? lo : hi;
  const octaves = Math.abs(Math.log2(value / ref));
  return clamp01(1 - octaves / toleranceOctaves);
}

/**
 * Distancia DTW entre dois contornos normalizados.
 * Alinhar no tempo importa porque a mesma ave canta a mesma frase mais rapido
 * ou mais devagar conforme a temperatura, a hora e o contexto.
 */
export function dtwSimilarity(a: number[], b: number[]): number {
  const n = a.length;
  const m = b.length;
  if (n === 0 || m === 0) return 0;

  const INF = Number.POSITIVE_INFINITY;
  let prev = new Float64Array(m + 1).fill(INF);
  let curr = new Float64Array(m + 1).fill(INF);
  prev[0] = 0;

  for (let i = 1; i <= n; i++) {
    curr.fill(INF);
    curr[0] = INF;
    for (let j = 1; j <= m; j++) {
      const cost = Math.abs(a[i - 1] - b[j - 1]);
      const best = Math.min(prev[j], curr[j - 1], prev[j - 1]);
      curr[j] = cost + (best === INF ? 0 : best);
    }
    const swap = prev;
    prev = curr;
    curr = swap;
  }

  const normalized = prev[m] / (n + m);
  return clamp01(1 - normalized * 2.2);
}

/**
 * Alturas medianas das notas, normalizadas 0-1 dentro do trecho.
 *
 * O `motif` de cada especie e uma sequencia de NOTAS ("sobe, sobe mais, desce"),
 * nao uma curva continua. Compara-lo com o contorno achatado de todos os frames
 * misturava tudo — um trinado de 40 notas virava uma linha reta. Comparar
 * sequencia com sequencia dobrou o poder do termo na bancada, de 2.1% para 4.1%
 * de acerto isolado.
 */
function noteSequence(notes: { peakHz: number }[]): number[] {
  const pitches = notes.map((n) => n.peakHz).filter((v) => v > 0);
  if (pitches.length < 2) return [];
  const lo = Math.min(...pitches);
  const hi = Math.max(...pitches);
  if (hi <= lo) return pitches.map(() => 0.5);
  return pitches.map((v) => (v - lo) / (hi - lo));
}

function motifSimilarity(f: AcousticFeatures, motif?: number[]): number {
  if (!motif || motif.length < 2) return 0.5;
  const sequence = noteSequence(f.notes);
  if (sequence.length >= 2) return dtwSimilarity(sequence, motif);
  // com uma nota so nao ha sequencia: cai para o contorno de frames
  return dtwSimilarity(f.melodyContour, resample(motif, f.melodyContour.length));
}

interface Term {
  key: string;
  label: string;
  score: number;
  weight: number;
  detail: string;
}

/** Media ponderada dos termos — a forma que melhor mediu na bancada. */
function weightedMean(terms: Term[]): number {
  let num = 0;
  let den = 0;
  for (const t of terms) {
    num += t.score * t.weight;
    den += t.weight;
  }
  return den > 0 ? num / den : 0;
}

function rhythmScore(f: AcousticFeatures, species: Species): number {
  const regular = 1 - clamp01(f.rhythmIrregularity);
  switch (species.acoustic.rhythm) {
    case 'trinado':
      return clamp01(f.trillIndex * 0.7 + regular * 0.3);
    case 'serie-regular':
      return clamp01(regular * 0.7 + clamp01(f.phraseRepetition) * 0.3);
    case 'serie-acelerada':
      // acelerando: os intervalos encurtam, entao ha irregularidade moderada
      return clamp01(1 - Math.abs(f.rhythmIrregularity - 0.35) / 0.5);
    case 'nota-isolada':
      return clamp01(1 - clamp01((f.noteRate - 1.5) / 6));
    case 'frase':
      return clamp01(f.stereotypy * 0.5 + clamp01(f.phraseRepetition) * 0.3 + regular * 0.2);
    case 'irregular':
      return clamp01(f.rhythmIrregularity * 0.8 + 0.2);
    default:
      return 0.5;
  }
}

function scoreSpecies(f: AcousticFeatures, species: Species): { fit: number; terms: Term[] } {
  const a = species.acoustic;

  const terms: Term[] = [
    {
      key: 'peak',
      label: 'Frequencia dominante',
      score: logRangeScore(f.peakHz, a.peakHz, 0.75),
      weight: 3.2,
      detail: `${Math.round(f.peakHz)} Hz medidos vs ${a.peakHz[0]}-${a.peakHz[1]} Hz esperados`,
    },
    {
      key: 'band',
      label: 'Faixa ocupada',
      score:
        (logRangeScore(Math.max(f.lowHz, 1), a.bandHz, 0.9) + logRangeScore(Math.max(f.highHz, 1), a.bandHz, 0.9)) / 2,
      weight: 1.5,
      detail: `${Math.round(f.lowHz)}-${Math.round(f.highHz)} Hz vs ${a.bandHz[0]}-${a.bandHz[1]} Hz`,
    },
    {
      key: 'rate',
      label: 'Velocidade de emissao',
      score: rangeScore(f.noteRate, a.noteRate, 0.8),
      weight: 2.0,
      detail: `${f.noteRate.toFixed(1)} notas/s vs ${a.noteRate[0]}-${a.noteRate[1]}`,
    },
    {
      key: 'noteDur',
      label: 'Duracao das notas',
      score: logRangeScore(Math.max(f.noteDurationMean, 0.004), a.noteDurationSec, 0.85),
      weight: 2.4,
      detail: `${(f.noteDurationMean * 1000).toFixed(0)} ms vs ${(a.noteDurationSec[0] * 1000).toFixed(0)}-${(
        a.noteDurationSec[1] * 1000
      ).toFixed(0)} ms`,
    },
    {
      key: 'tonality',
      label: 'Timbre (puro x aspero)',
      score: rangeScore(f.tonality, a.tonality, 0.7),
      weight: 2.6,
      detail: `${Math.round(f.tonality * 100)}% de pureza vs ${Math.round(a.tonality[0] * 100)}-${Math.round(
        a.tonality[1] * 100,
      )}%`,
    },
    {
      key: 'fm',
      label: 'Modulacao de frequencia',
      score: rangeScore(f.fmDepth, a.fmDepth, 0.9),
      weight: 1.8,
      detail: `${Math.round(f.fmDepth * 100)}% vs ${Math.round(a.fmDepth[0] * 100)}-${Math.round(a.fmDepth[1] * 100)}%`,
    },
    {
      key: 'phrase',
      label: 'Duracao da frase',
      score: logRangeScore(Math.max(f.phraseDurationSec, 0.05), a.phraseSec, 1.1),
      weight: 1.1,
      detail: `${f.phraseDurationSec.toFixed(1)} s vs ${a.phraseSec[0]}-${a.phraseSec[1]} s`,
    },
    {
      key: 'motif',
      label: 'Contorno melodico',
      score: motifSimilarity(f, a.motif),
      weight: 2.0,
      detail: a.motif ? 'sequencia de alturas das notas alinhada no tempo' : 'sem motivo de referencia',
    },
    {
      key: 'rhythm',
      label: 'Padrao ritmico',
      score: rhythmScore(f, species),
      weight: 1.6,
      detail: `esperado: ${a.rhythm}`,
    },
  ];

  if (a.notesPerPhrase) {
    const perPhrase = f.phrases.length ? f.noteCount / f.phrases.length : f.noteCount;
    terms.push({
      key: 'notes',
      label: 'Notas por frase',
      score: rangeScore(perPhrase, a.notesPerPhrase, 1.2),
      weight: 1.2,
      detail: `${perPhrase.toFixed(1)} vs ${a.notesPerPhrase[0]}-${a.notesPerPhrase[1]}`,
    });
  }

  return { fit: weightedMean(terms), terms };
}

const SOFTMAX_TEMPERATURE = 0.055;
/** abaixo desta aderencia nao ha nada na base parecido com o gravado */
const INCONCLUSIVE_FIT = 0.52;

export interface MatchOptions {
  /** limita a busca a um subconjunto */
  candidates?: Species[];
  topN?: number;
  /** pistas de campo do usuario: reordenam sem eliminar ninguem */
  context?: FieldContext;
  /** gravacoes que o usuario ja confirmou, usadas como referencia */
  exemplars?: Exemplar[];
}

export function matchSpecies(f: AcousticFeatures, options: MatchOptions = {}): MatchResult {
  const pool = options.candidates ?? ALL_SPECIES;
  const topN = options.topN ?? 5;

  // Exemplares do usuario: uma gravacao real e etiquetada descreve a ave muito
  // melhor que qualquer faixa escrita a mao, entao ela entra como evidencia
  // paralela ao perfil.
  const exemplarMatches = options.exemplars?.length ? matchExemplars(f, options.exemplars) : undefined;

  const scored = pool.map((species) => {
    const { fit: profileFit, terms } = scoreSpecies(f, species);
    const exemplar = exemplarMatches?.get(species.id);
    const fit = blendWithExemplar(profileFit, exemplar);
    const sorted = [...terms].sort((x, y) => y.score * y.weight - x.score * x.weight);
    const learned =
      exemplar && fit > profileFit
        ? [
            {
              label: 'Parecido com gravacao sua',
              ok: true,
              detail: `${Math.round(exemplar.similarity * 100)}% de semelhanca com ${exemplar.count} registro(s) seu(s) — entra como desempate, nao decide sozinho`,
            },
          ]
        : [];
    const reasons = [
      ...learned,
      ...sorted.slice(0, 3).map((t) => ({ label: t.label, ok: t.score >= 0.6, detail: t.detail })),
      ...sorted
        .slice(-2)
        .filter((t) => t.score < 0.5)
        .map((t) => ({ label: t.label, ok: false, detail: t.detail })),
    ];
    // O contexto de campo entra como peso, nao como filtro: uma ave fora do
    // habitat esperado recua na lista mas continua visivel.
    return { species, fit: fit * contextWeight(species, options.context), reasons };
  });

  scored.sort((a, b) => b.fit - a.fit);
  const head = scored.slice(0, topN);

  const max = head[0]?.fit ?? 0;
  const exps = head.map((s) => Math.exp((s.fit - max) / SOFTMAX_TEMPERATURE));
  const sum = exps.reduce((a, b) => a + b, 0) || 1;

  const matches: SpeciesMatch[] = head.map((s, i) => ({
    species: s.species,
    probability: exps[i] / sum,
    fit: s.fit,
    reasons: s.reasons,
  }));

  const notes: string[] = [];
  const inconclusive = max < INCONCLUSIVE_FIT || f.signalQuality < 0.22 || f.noteCount === 0;

  if (f.noteCount === 0) notes.push('Nenhuma vocalizacao destacou-se do ruido de fundo.');
  else if (f.signalQuality < 0.35) notes.push('Sinal fraco: aproxime-se da ave ou grave em ambiente mais silencioso.');
  if (max < INCONCLUSIVE_FIT) notes.push('O canto nao bate bem com nenhuma especie da base local.');
  if (matches.length > 1 && matches[0].probability - matches[1].probability < 0.12) {
    notes.push(`Resultado disputado com ${matches[1].species.commonName}: grave mais alguns segundos.`);
  }

  const separation = matches.length > 1 ? matches[0].probability - matches[1].probability : 1;
  const confidence = clamp01(max * 0.6 + separation * 0.25 + f.signalQuality * 0.15);

  return { matches, confidence, inconclusive, notes };
}
