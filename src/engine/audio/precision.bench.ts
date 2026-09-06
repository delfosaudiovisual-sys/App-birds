import { describe, expect, it } from 'vitest';
import { ALL_SPECIES } from '../../data/species';
import { extractFeatures } from './features';
import { matchSpecies } from './matcher';
import { environmentsFor, sizeClassesFor } from '../../data/occurrence';
import { analysisWindow } from './recorder';
import { synthesizeSpecies, type Degradation } from './testing/synth';

/**
 * Banco de provas de identificacao por canto.
 *
 * O QUE ISTO MEDE: se as especies da base sao distinguiveis umas das outras
 * pelo motor, e se o acerto sobrevive a degradacao de campo (ruido, distancia,
 * desafinacao, andamento diferente, trecho cortado).
 *
 * O QUE ISTO NAO MEDE: acerto em gravacao real. Os sinais sao sintetizados a
 * partir dos mesmos perfis que o matcher consulta, entao ha circularidade —
 * um perfil errado passa despercebido aqui. Para acerto de campo so serve
 * gravacao real etiquetada. O valor deste banco e outro: ele pega confusao
 * entre especies e quebra de robustez, e transforma "melhorou o algoritmo" em
 * numero verificavel.
 */

interface Condition {
  name: string;
  degradation: Partial<Degradation>;
}

const CONDITIONS: Condition[] = [
  { name: 'limpo', degradation: {} },
  { name: 'ruido 12 dB', degradation: { snrDb: 12 } },
  { name: 'ruido 6 dB', degradation: { snrDb: 6 } },
  { name: 'distante', degradation: { snrDb: 10, highCut: 0.55 } },
  { name: 'desafinado', degradation: { pitchScale: 1.14, snrDb: 18 } },
  { name: 'andamento', degradation: { tempoScale: 1.35, snrDb: 18 } },
  { name: 'trecho parcial', degradation: { coverage: 0.45, snrDb: 15 } },
];

const SEEDS = [11, 29];

export interface BenchScore {
  condition: string;
  top1: number;
  top3: number;
  samples: number;
}

function runCondition(condition: Condition, withContext: boolean): BenchScore {
  let hits1 = 0;
  let hits3 = 0;
  let total = 0;

  for (const species of ALL_SPECIES) {
    for (const seed of SEEDS) {
      const { samples, sampleRate } = synthesizeSpecies(species, {
        seed: seed + species.id.length * 7,
        degradation: condition.degradation,
      });
      const { features } = extractFeatures(samples, sampleRate, analysisWindow(sampleRate));
      // Com contexto, o teste simula um usuario que informa corretamente onde
      // esta e o tamanho aproximado da ave — o cenario de uso real do recurso.
      const context = withContext
        ? { environment: environmentsFor(species)[0], sizeClass: sizeClassesFor(species)[0] }
        : undefined;
      const result = matchSpecies(features, { topN: 3, context });
      const ids = result.matches.map((m) => m.species.id);
      if (ids[0] === species.id) hits1++;
      if (ids.includes(species.id)) hits3++;
      total++;
    }
  }

  return { condition: condition.name, top1: hits1 / total, top3: hits3 / total, samples: total };
}

export function runBenchmark(withContext = false): BenchScore[] {
  return CONDITIONS.map((c) => runCondition(c, withContext));
}

describe('precisao da identificacao por canto', () => {
  const scores = runBenchmark(false);
  const withContext = runBenchmark(true);
  const overall1 = scores.reduce((s, r) => s + r.top1, 0) / scores.length;
  const overall3 = scores.reduce((s, r) => s + r.top3, 0) / scores.length;
  const ctx1 = withContext.reduce((s, r) => s + r.top1, 0) / withContext.length;
  const ctx3 = withContext.reduce((s, r) => s + r.top3, 0) / withContext.length;

  it('publica a tabela de precisao', () => {
    const table = scores
      .map((s, i) => {
        const c = withContext[i];
        return `  ${s.condition.padEnd(16)} ${(s.top1 * 100).toFixed(1).padStart(5)}% ${(s.top3 * 100)
          .toFixed(1)
          .padStart(6)}%   |  ${(c.top1 * 100).toFixed(1).padStart(5)}% ${(c.top3 * 100).toFixed(1).padStart(6)}%`;
      })
      .join('\n');
    console.log(
      `\nPrecisao (${ALL_SPECIES.length} especies x ${SEEDS.length} amostras)\n` +
        `  ${'condicao'.padEnd(16)}  sem pistas     |  com pistas de campo\n` +
        `  ${''.padEnd(16)}  top1   top3    |  top1   top3\n${table}\n` +
        `  ${'MEDIA'.padEnd(16)} ${(overall1 * 100).toFixed(1).padStart(5)}% ${(overall3 * 100)
          .toFixed(1)
          .padStart(6)}%   |  ${(ctx1 * 100).toFixed(1).padStart(5)}% ${(ctx3 * 100).toFixed(1).padStart(6)}%\n`,
    );
    expect(scores).toHaveLength(CONDITIONS.length);
  });

  it('acerta a especie em audio limpo', () => {
    const clean = scores.find((s) => s.condition === 'limpo')!;
    expect(clean.top1).toBeGreaterThan(0.2);
    expect(clean.top3).toBeGreaterThan(0.42);
  });

  it('sobrevive a ruido de campo', () => {
    const noisy = scores.find((s) => s.condition === 'ruido 6 dB')!;
    expect(noisy.top3).toBeGreaterThan(0.35);
  });

  it('mantem media aceitavel em todas as condicoes', () => {
    expect(overall1).toBeGreaterThan(0.18);
    expect(overall3).toBeGreaterThan(0.4);
  });

  it('melhora quando o usuario informa ambiente e tamanho', () => {
    expect(ctx1).toBeGreaterThan(overall1 + 0.05);
    expect(ctx3).toBeGreaterThan(overall3 + 0.05);
  });
});
