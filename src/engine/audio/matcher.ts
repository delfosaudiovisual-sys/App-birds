import { ALL_SPECIES } from '../../data/species';
import type { Range, Species } from '../../data/types';
import { clamp01, resample, type AcousticFeatures } from './features';

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
 * Pontua um valor contra uma faixa esperada. Dentro da faixa vale 1; fora,
 * decai suavemente numa largura proporcional a propria faixa, para que
 * intervalos largos sejam naturalmente mais tolerantes.
 */
function rangeScore(value: number, [lo, hi]: Range, tolerance = 0.6): number {
  if (value >= lo && value <= hi) return 1;
  const width = Math.max(hi - lo, 1e-6);
  const d = value < lo ? lo - value : value - hi;
  return clamp01(1 - d / (width * tolerance + 1e-6));
}

/** Igual ao anterior, mas em oitavas: a percepcao de altura e logaritmica. */
function logRangeScore(value: number, [lo, hi]: Range, toleranceOctaves = 0.7): number {
  if (value <= 0) return 0;
  if (value >= lo && value <= hi) return 1;
  const ref = value < lo ? lo : hi;
  const octaves = Math.abs(Math.log2(value / ref));
  return clamp01(1 - octaves / toleranceOctaves);
}

/**
 * Distancia DTW entre dois contornos melodicos normalizados.
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

  const pathLength = n + m;
  const normalized = prev[m] / pathLength;
  // custo medio por passo esta em 0..1 (contornos normalizados)
  return clamp01(1 - normalized * 2.2);
}

/**
 * Compara o contorno tambem depois de remover a media: a forma da melodia
 * (sobe-desce) importa mais que a altura absoluta, que ja e avaliada em peakHz.
 */
function motifSimilarity(contour: number[], motif?: number[]): number {
  if (!motif || motif.length === 0) return 0.5;
  const target = resample(motif, contour.length);
  const direct = dtwSimilarity(contour, target);

  const shift = avg(contour) - avg(target);
  const shifted = target.map((v) => clamp01(v + shift));
  const centered = dtwSimilarity(contour, shifted);

  return Math.max(direct, centered);
}

function avg(v: number[]): number {
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0;
}

interface Term {
  key: string;
  label: string;
  score: number;
  weight: number;
  detail: string;
}

function scoreSpecies(f: AcousticFeatures, species: Species): { fit: number; terms: Term[] } {
  const a = species.acoustic;

  const terms: Term[] = [
    {
      key: 'peak',
      label: 'Frequencia dominante',
      score: logRangeScore(f.peakHz, a.peakHz, 0.55),
      weight: 3.0,
      detail: `${Math.round(f.peakHz)} Hz medidos vs ${a.peakHz[0]}-${a.peakHz[1]} Hz esperados`,
    },
    {
      key: 'band',
      label: 'Faixa ocupada',
      score:
        (logRangeScore(Math.max(f.lowHz, 1), [a.bandHz[0], a.bandHz[1]], 0.9) +
          logRangeScore(Math.max(f.highHz, 1), [a.bandHz[0], a.bandHz[1]], 0.9)) /
        2,
      weight: 1.4,
      detail: `${Math.round(f.lowHz)}-${Math.round(f.highHz)} Hz vs ${a.bandHz[0]}-${a.bandHz[1]} Hz`,
    },
    {
      key: 'rate',
      label: 'Velocidade de emissao',
      score: rangeScore(f.noteRate, a.noteRate, 0.9),
      weight: 2.4,
      detail: `${f.noteRate.toFixed(1)} notas/s vs ${a.noteRate[0]}-${a.noteRate[1]}`,
    },
    {
      key: 'noteDur',
      label: 'Duracao das notas',
      score: rangeScore(f.noteDurationMean, a.noteDurationSec, 1.1),
      weight: 1.6,
      detail: `${(f.noteDurationMean * 1000).toFixed(0)} ms vs ${(a.noteDurationSec[0] * 1000).toFixed(0)}-${(
        a.noteDurationSec[1] * 1000
      ).toFixed(0)} ms`,
    },
    {
      key: 'tonality',
      label: 'Timbre (puro x aspero)',
      score: rangeScore(f.tonality, a.tonality, 0.8),
      weight: 2.2,
      detail: `${Math.round(f.tonality * 100)}% de pureza vs ${Math.round(a.tonality[0] * 100)}-${Math.round(
        a.tonality[1] * 100,
      )}%`,
    },
    {
      key: 'fm',
      label: 'Modulacao de frequencia',
      score: rangeScore(f.fmDepth, a.fmDepth, 1.0),
      weight: 1.3,
      detail: `${Math.round(f.fmDepth * 100)}% vs ${Math.round(a.fmDepth[0] * 100)}-${Math.round(a.fmDepth[1] * 100)}%`,
    },
    {
      key: 'phrase',
      label: 'Duracao da frase',
      score: rangeScore(f.phraseDurationSec, a.phraseSec, 1.2),
      weight: 1.1,
      detail: `${f.phraseDurationSec.toFixed(1)} s vs ${a.phraseSec[0]}-${a.phraseSec[1]} s`,
    },
    {
      key: 'motif',
      label: 'Contorno melodico',
      score: motifSimilarity(f.melodyContour, a.motif),
      weight: 2.6,
      detail: a.motif ? 'alinhamento temporal do desenho de altura' : 'sem motivo de referencia',
    },
    {
      key: 'rhythm',
      label: 'Padrao ritmico',
      score: rhythmScore(f, species),
      weight: 1.5,
      detail: `esperado: ${a.rhythm}`,
    },
  ];

  if (a.notesPerPhrase) {
    terms.push({
      key: 'notes',
      label: 'Notas por frase',
      score: rangeScore(f.noteCount, a.notesPerPhrase, 1.4),
      weight: 0.9,
      detail: `${f.noteCount} vs ${a.notesPerPhrase[0]}-${a.notesPerPhrase[1]}`,
    });
  }

  let num = 0;
  let den = 0;
  for (const t of terms) {
    num += t.score * t.weight;
    den += t.weight;
  }
  return { fit: den > 0 ? num / den : 0, terms };
}

function rhythmScore(f: AcousticFeatures, species: Species): number {
  const regular = 1 - clamp01(f.rhythmIrregularity);
  switch (species.acoustic.rhythm) {
    case 'trinado':
      return clamp01(f.trillIndex * 0.7 + regular * 0.3);
    case 'serie-regular':
      return clamp01(regular * 0.7 + clamp01(f.phraseRepetition) * 0.3);
    case 'serie-acelerada':
      // acelerando: intervalos encurtam, entao ha irregularidade moderada
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

const SOFTMAX_TEMPERATURE = 0.055;
/** abaixo disso nao ha aderencia suficiente pra afirmar especie alguma */
const INCONCLUSIVE_FIT = 0.52;

export interface MatchOptions {
  /** limita a busca a um subconjunto (ex.: filtro por regiao) */
  candidates?: Species[];
  topN?: number;
}

export function matchSpecies(f: AcousticFeatures, options: MatchOptions = {}): MatchResult {
  const pool = options.candidates ?? ALL_SPECIES;
  const topN = options.topN ?? 5;

  const scored = pool.map((species) => {
    const { fit, terms } = scoreSpecies(f, species);
    const sorted = [...terms].sort((x, y) => y.score * y.weight - x.score * x.weight);
    const reasons = [
      ...sorted.slice(0, 3).map((t) => ({ label: t.label, ok: t.score >= 0.6, detail: t.detail })),
      ...sorted
        .slice(-2)
        .filter((t) => t.score < 0.5)
        .map((t) => ({ label: t.label, ok: false, detail: t.detail })),
    ];
    return { species, fit, reasons };
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
