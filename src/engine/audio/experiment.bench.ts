import { describe, it } from 'vitest';
import { ALL_SPECIES } from '../../data/species';
import type { Range, Species } from '../../data/types';
import { extractFeatures, type AcousticFeatures } from './features';
import { analysisWindow } from './recorder';
import { synthesizeSpecies, type Degradation } from './testing/synth';
import { dtwSimilarity } from './matcher';
import { resample as resampleContour } from './features';

/**
 * Bancada de experimentos: extrai as features UMA vez e depois avalia varias
 * configuracoes de pontuacao em cima do cache. Sem isso, cada variante custa
 * ~90 s de FFT e afinar o ranqueamento vira adivinhacao cara.
 */

const CONDITIONS: { name: string; degradation: Partial<Degradation> }[] = [
  { name: 'limpo', degradation: {} },
  { name: 'ruido 6 dB', degradation: { snrDb: 6 } },
  { name: 'distante', degradation: { snrDb: 10, highCut: 0.55 } },
  { name: 'desafinado', degradation: { pitchScale: 1.14, snrDb: 18 } },
  { name: 'andamento', degradation: { tempoScale: 1.35, snrDb: 18 } },
];
const SEEDS = [11, 29];

interface Sample {
  truth: string;
  features: AcousticFeatures;
}

function buildCache(): Sample[] {
  const out: Sample[] = [];
  for (const condition of CONDITIONS) {
    for (const species of ALL_SPECIES) {
      for (const seed of SEEDS) {
        const { samples, sampleRate } = synthesizeSpecies(species, {
          seed: seed + species.id.length * 7,
          degradation: condition.degradation,
        });
        const { features } = extractFeatures(samples, sampleRate, analysisWindow(sampleRate));
        out.push({ truth: species.id, features });
      }
    }
  }
  return out;
}

// ---------------- funcoes de pontuacao candidatas ----------------

function centerScore(value: number, [lo, hi]: Range, log = false): number {
  const v = log ? Math.log2(Math.max(value, 1e-3)) : value;
  const a = log ? Math.log2(Math.max(lo, 1e-3)) : lo;
  const b = log ? Math.log2(Math.max(hi, lo + 1e-3)) : hi;
  const mu = (a + b) / 2;
  const sigma = Math.max((b - a) / 2 / 1.5, 1e-6);
  return Math.exp(-0.5 * ((v - mu) / sigma) ** 2);
}

function plateauScore(value: number, [lo, hi]: Range, tol: number, log = false): number {
  const v = log ? Math.log2(Math.max(value, 1e-3)) : value;
  const a = log ? Math.log2(Math.max(lo, 1e-3)) : lo;
  const b = log ? Math.log2(Math.max(hi, lo + 1e-3)) : hi;
  if (v >= a && v <= b) return 1;
  const width = Math.max(b - a, 1e-6);
  const d = v < a ? a - v : v - b;
  return Math.max(0, 1 - d / (width * tol + 1e-6));
}

type Scorer = (f: AcousticFeatures, s: Species) => number;

/** Alturas medianas das notas, normalizadas 0-1 dentro do trecho comparado. */
function noteSequence(f: AcousticFeatures, firstPhraseOnly: boolean): number[] {
  let notes = f.notes;
  if (firstPhraseOnly && f.phrases.length > 0) {
    const best = f.phrases.reduce((a, b) => (b.noteCount > a.noteCount ? b : a));
    notes = f.notes.filter((n) => n.startSec >= best.startSec - 1e-6 && n.endSec <= best.endSec + 1e-6);
  }
  const pitches = notes.map((n) => n.peakHz).filter((v) => v > 0);
  if (pitches.length < 2) return [];
  const lo = Math.min(...pitches);
  const hi = Math.max(...pitches);
  if (hi <= lo) return pitches.map(() => 0.5);
  return pitches.map((v) => (v - lo) / (hi - lo));
}

function noteSequenceSimilarity(f: AcousticFeatures, s: Species, firstPhraseOnly = false): number {
  const motif = s.acoustic.motif;
  if (!motif || motif.length < 2) return 0.5;
  const seq = noteSequence(f, firstPhraseOnly);
  if (seq.length < 2) return 0.5;
  return dtwSimilarity(seq, motif);
}

const FEATURES: { key: string; center: Scorer; plateau: Scorer }[] = [
  {
    key: 'peakHz',
    center: (f, s) => centerScore(f.peakHz, s.acoustic.peakHz, true),
    plateau: (f, s) => plateauScore(f.peakHz, s.acoustic.peakHz, 0.9, true),
  },
  {
    key: 'noteRate',
    center: (f, s) => centerScore(Math.max(f.noteRate, 0.05), s.acoustic.noteRate, true),
    plateau: (f, s) => plateauScore(Math.max(f.noteRate, 0.05), s.acoustic.noteRate, 0.9, true),
  },
  {
    key: 'noteDur',
    center: (f, s) => centerScore(Math.max(f.noteDurationMean, 0.004), s.acoustic.noteDurationSec, true),
    plateau: (f, s) => plateauScore(Math.max(f.noteDurationMean, 0.004), s.acoustic.noteDurationSec, 1.0, true),
  },
  {
    key: 'tonality',
    center: (f, s) => centerScore(f.tonality, s.acoustic.tonality),
    plateau: (f, s) => plateauScore(f.tonality, s.acoustic.tonality, 0.8),
  },
  {
    key: 'fmDepth',
    center: (f, s) => centerScore(f.fmDepth, s.acoustic.fmDepth),
    plateau: (f, s) => plateauScore(f.fmDepth, s.acoustic.fmDepth, 1.0),
  },
  {
    key: 'phraseSec',
    center: (f, s) => centerScore(Math.max(f.phraseDurationSec, 0.05), s.acoustic.phraseSec, true),
    plateau: (f, s) => plateauScore(Math.max(f.phraseDurationSec, 0.05), s.acoustic.phraseSec, 1.2, true),
  },
  {
    key: 'bandLow',
    center: (f, s) => centerScore(Math.max(f.lowHz, 1), s.acoustic.bandHz, true),
    plateau: (f, s) => plateauScore(Math.max(f.lowHz, 1), s.acoustic.bandHz, 0.9, true),
  },
  {
    key: 'bandHigh',
    center: (f, s) => centerScore(Math.max(f.highHz, 1), s.acoustic.bandHz, true),
    plateau: (f, s) => plateauScore(Math.max(f.highHz, 1), s.acoustic.bandHz, 0.9, true),
  },
  {
    key: 'notesPerPhrase',
    center: (f, s) =>
      s.acoustic.notesPerPhrase
        ? centerScore(Math.max(f.phrases.length ? f.noteCount / f.phrases.length : f.noteCount, 0.5), s.acoustic.notesPerPhrase, true)
        : 0.5,
    plateau: (f, s) =>
      s.acoustic.notesPerPhrase
        ? plateauScore(Math.max(f.phrases.length ? f.noteCount / f.phrases.length : f.noteCount, 0.5), s.acoustic.notesPerPhrase, 1.4, true)
        : 0.5,
  },
  {
    key: 'motif(frame)',
    center: (f, s) => (s.acoustic.motif ? dtwSimilarity(f.melodyContour, resampleContour(s.acoustic.motif, 32)) : 0.5),
    plateau: (f, s) => (s.acoustic.motif ? dtwSimilarity(f.melodyContour, resampleContour(s.acoustic.motif, 32)) : 0.5),
  },
  {
    // O motivo do perfil e uma sequencia de NOTAS, nao uma curva continua.
    // Compara-lo com o contorno achatado de todos os frames mistura tudo:
    // um trinado de 40 notas vira uma linha. Aqui comparamos sequencia com
    // sequencia — a altura mediana de cada nota, normalizada.
    key: 'motif(notas)',
    center: (f, s) => noteSequenceSimilarity(f, s),
    plateau: (f, s) => noteSequenceSimilarity(f, s),
  },
  {
    key: 'motif(1a frase)',
    center: (f, s) => noteSequenceSimilarity(f, s, true),
    plateau: (f, s) => noteSequenceSimilarity(f, s, true),
  },
  {
    key: 'trill',
    center: (f, s) => 1 - Math.abs(f.trillIndex - (s.acoustic.rhythm === 'trinado' ? 0.55 : 0.05)),
    plateau: (f, s) => 1 - Math.abs(f.trillIndex - (s.acoustic.rhythm === 'trinado' ? 0.55 : 0.05)),
  },
  {
    key: 'irregular',
    center: (f, s) => 1 - Math.abs(f.rhythmIrregularity - (s.acoustic.rhythm === 'irregular' ? 0.7 : 0.25)),
    plateau: (f, s) => 1 - Math.abs(f.rhythmIrregularity - (s.acoustic.rhythm === 'irregular' ? 0.7 : 0.25)),
  },
];

function accuracy(cache: Sample[], score: (f: AcousticFeatures, s: Species) => number) {
  let top1 = 0;
  let top3 = 0;
  for (const sample of cache) {
    const ranked = ALL_SPECIES.map((s) => ({ id: s.id, v: score(sample.features, s) })).sort((a, b) => b.v - a.v);
    if (ranked[0].id === sample.truth) top1++;
    if (ranked.slice(0, 3).some((r) => r.id === sample.truth)) top3++;
  }
  return { top1: top1 / cache.length, top3: top3 / cache.length };
}

describe('bancada de pontuacao', () => {
  const cache = buildCache();

  it('mede o poder discriminativo de cada caracteristica isolada', () => {
    const rows = FEATURES.map((feature) => {
      const c = accuracy(cache, feature.center);
      const p = accuracy(cache, feature.plateau);
      return { key: feature.key, centro: c.top1, patamar: p.top1, centro3: c.top3 };
    }).sort((a, b) => b.centro - a.centro);

    console.log('\nPoder discriminativo isolado (top1 entre 58 especies, acaso = 1.7%)');
    console.log('  caracteristica     centro    patamar   centro-top3');
    for (const r of rows) {
      console.log(
        `  ${r.key.padEnd(16)} ${(r.centro * 100).toFixed(1).padStart(6)}%  ${(r.patamar * 100)
          .toFixed(1)
          .padStart(6)}%  ${(r.centro3 * 100).toFixed(1).padStart(6)}%`,
      );
    }
  });

  it('mede o ganho de restringir os candidatos', () => {
    const best = (f: AcousticFeatures, s: Species) =>
      FEATURES.reduce((acc, x) => acc + x.plateau(f, s), 0) / FEATURES.length;

    console.log('\nGanho de reduzir o conjunto de candidatos (media aritmetica + patamar)');
    for (const poolSize of [58, 40, 25, 15, 8]) {
      let top1 = 0;
      let top3 = 0;
      for (const sample of cache) {
        // simula um filtro de regiao: a especie certa mais N distratoras
        const truthIdx = ALL_SPECIES.findIndex((s) => s.id === sample.truth);
        const pool = [ALL_SPECIES[truthIdx]];
        for (let i = 1; pool.length < poolSize; i++) {
          const candidate = ALL_SPECIES[(truthIdx + i * 7) % ALL_SPECIES.length];
          if (!pool.includes(candidate)) pool.push(candidate);
        }
        const ranked = pool.map((s) => ({ id: s.id, v: best(sample.features, s) })).sort((a, b) => b.v - a.v);
        if (ranked[0].id === sample.truth) top1++;
        if (ranked.slice(0, 3).some((r) => r.id === sample.truth)) top3++;
      }
      console.log(
        `  ${String(poolSize).padStart(3)} candidatos   top1 ${((top1 / cache.length) * 100).toFixed(1).padStart(5)}%  top3 ${((top3 / cache.length) * 100).toFixed(1).padStart(5)}%`,
      );
    }
  });

  it('compara formas de combinar', () => {
    const combos: { name: string; fn: (f: AcousticFeatures, s: Species) => number }[] = [
      {
        name: 'aritmetica (centro)',
        fn: (f, s) => FEATURES.reduce((acc, x) => acc + x.center(f, s), 0) / FEATURES.length,
      },
      {
        name: 'aritmetica (patamar)',
        fn: (f, s) => FEATURES.reduce((acc, x) => acc + x.plateau(f, s), 0) / FEATURES.length,
      },
      {
        name: 'geometrica (centro)',
        fn: (f, s) => Math.exp(FEATURES.reduce((acc, x) => acc + Math.log(Math.max(x.center(f, s), 0.02)), 0) / FEATURES.length),
      },
      {
        name: 'geometrica (patamar)',
        fn: (f, s) => Math.exp(FEATURES.reduce((acc, x) => acc + Math.log(Math.max(x.plateau(f, s), 0.02)), 0) / FEATURES.length),
      },
    ];
    console.log('\nFormas de combinar (todas as caracteristicas, peso igual)');
    for (const combo of combos) {
      const a = accuracy(cache, combo.fn);
      console.log(`  ${combo.name.padEnd(22)} top1 ${(a.top1 * 100).toFixed(1).padStart(5)}%  top3 ${(a.top3 * 100).toFixed(1).padStart(5)}%`);
    }
  });
});
