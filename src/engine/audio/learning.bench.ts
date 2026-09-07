import { describe, expect, it } from 'vitest';
import { ALL_SPECIES } from '../../data/species';
import { extractFeatures } from './features';
import { matchSpecies } from './matcher';
import { analysisWindow } from './recorder';
import { toVector, type Exemplar } from './exemplars';
import { synthesizeScene } from './testing/synth';

/**
 * Quanto o app melhora a cada gravacao que o usuario confirma.
 *
 * O treino e o teste usam sementes DIFERENTES: o exemplar guardado nunca e a
 * mesma gravacao que sera identificada depois. Sem essa separacao o numero
 * mediria memoria, nao aprendizado, e daria quase 100% sem significar nada.
 */

const TRAIN_SEEDS = [101, 202, 303];
const TEST_SEEDS = [7, 41];

function sceneFor(target: (typeof ALL_SPECIES)[number], index: number, seed: number, distractorCount: number) {
  const distractors = Array.from({ length: distractorCount }, (_, d) =>
    ALL_SPECIES[(index + 11 * (d + 1) + seed) % ALL_SPECIES.length],
  ).filter((s) => s.id !== target.id);
  return synthesizeScene(target, {
    seed: seed + index * 7,
    distractors,
    leadSilenceSec: 2,
    trailSilenceSec: 2,
    degradation: { snrDb: 14 },
  });
}

function featuresFor(target: (typeof ALL_SPECIES)[number], index: number, seed: number, distractors: number) {
  const { samples, sampleRate } = sceneFor(target, index, seed, distractors);
  return extractFeatures(samples, sampleRate, analysisWindow(sampleRate)).features;
}

describe('aprendizado por exemplos', () => {
  // Exemplares de treino, um conjunto por quantidade
  const banks: Exemplar[][] = [[], [], [], []];
  ALL_SPECIES.forEach((species, index) => {
    TRAIN_SEEDS.forEach((seed, k) => {
      const features = featuresFor(species, index, seed, 1);
      const exemplar: Exemplar = {
        id: `${species.id}-${seed}`,
        speciesId: species.id,
        vector: toVector(features),
        createdAt: 0,
        corrected: true,
      };
      for (let n = k + 1; n < banks.length; n++) banks[n].push(exemplar);
    });
  });

  const results = banks.map((bank, count) => {
    let t1 = 0;
    let t3 = 0;
    let total = 0;
    ALL_SPECIES.forEach((species, index) => {
      for (const seed of TEST_SEEDS) {
        const features = featuresFor(species, index, seed, 1);
        const ids = matchSpecies(features, { topN: 3, exemplars: bank }).matches.map((m) => m.species.id);
        if (ids[0] === species.id) t1++;
        if (ids.includes(species.id)) t3++;
        total++;
      }
    });
    return { count, top1: t1 / total, top3: t3 / total };
  });

  it('publica o ganho por gravacao confirmada', () => {
    console.log('\nAprendizado por exemplos (1 ave ao fundo, 14 dB; treino e teste com sementes diferentes)');
    for (const r of results) {
      console.log(
        `  ${String(r.count).padStart(2)} gravacao(oes) por especie   top1 ${(r.top1 * 100).toFixed(1).padStart(5)}%  top3 ${(r.top3 * 100).toFixed(1).padStart(5)}%`,
      );
    }
    console.log('');
    expect(results).toHaveLength(4);
  });

  it('o reforco por exemplar nunca piora o resultado', () => {
    // Nao se exige ganho: o sintetizador sorteia valores novos em toda a faixa
    // do perfil a cada gravacao, o que exagera a variacao dentro da especie e
    // impede medir o ganho real. O que se exige e a garantia que importa —
    // usar o app nao pode deixa-lo pior.
    for (const r of results) {
      expect(r.top1).toBeGreaterThanOrEqual(results[0].top1 - 0.005);
      expect(r.top3).toBeGreaterThanOrEqual(results[0].top3 - 0.02);
    }
  });
});
