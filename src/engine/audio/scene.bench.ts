import { describe, expect, it } from 'vitest';
import { ALL_SPECIES } from '../../data/species';
import { extractFeatures } from './features';
import { matchSpecies } from './matcher';
import { identifySong } from './identify';
import { analysisWindow } from './recorder';
import { synthesizeScene } from './testing/synth';

/**
 * Banco de provas de CENA DE CAMPO.
 *
 * O banco anterior media uma especie sozinha num arquivo limpo. Isso mede
 * discriminacao, mas nao mede o que acontece quando alguem aperta gravar no
 * quintal: silencio antes e depois, ruido de fundo, e outras aves cantando por
 * cima. E a diferenca entre os dois numeros que diz se o problema esta no
 * casamento ou na forma de recortar a gravacao.
 */

interface SceneCase {
  name: string;
  distractors: number;
  snrDb: number;
  silence: number;
}

const CASES: SceneCase[] = [
  { name: 'so a ave, com pausa', distractors: 0, snrDb: 20, silence: 2 },
  { name: '1 ave ao fundo', distractors: 1, snrDb: 15, silence: 2 },
  { name: '2 aves ao fundo', distractors: 2, snrDb: 12, silence: 2.5 },
  { name: 'quintal cheio', distractors: 3, snrDb: 9, silence: 3 },
];

const SEEDS = [5, 23];

export function runSceneBench(
  identify: (samples: Float32Array, sampleRate: number) => string[],
): { name: string; top1: number; top3: number }[] {
  return CASES.map((scenario) => {
    let hits1 = 0;
    let hits3 = 0;
    let total = 0;

    ALL_SPECIES.forEach((target, index) => {
      for (const seed of SEEDS) {
        // distratoras escolhidas deterministicamente, longe do alvo na lista
        const distractors = Array.from({ length: scenario.distractors }, (_, d) =>
          ALL_SPECIES[(index + 11 * (d + 1) + seed) % ALL_SPECIES.length],
        ).filter((s) => s.id !== target.id);

        const { samples, sampleRate } = synthesizeScene(target, {
          seed: seed + index * 7,
          distractors,
          leadSilenceSec: scenario.silence,
          trailSilenceSec: scenario.silence,
          degradation: { snrDb: scenario.snrDb },
        });

        const ids = identify(samples, sampleRate);
        if (ids[0] === target.id) hits1++;
        if (ids.slice(0, 3).includes(target.id)) hits3++;
        total++;
      }
    });

    return { name: scenario.name, top1: hits1 / total, top3: hits3 / total };
  });
}

/** Identificacao atual: features do arquivo inteiro, de uma vez so. */
function identifyGlobal(samples: Float32Array, sampleRate: number): string[] {
  const { features } = extractFeatures(samples, sampleRate, analysisWindow(sampleRate));
  return matchSpecies(features, { topN: 3 }).matches.map((m) => m.species.id);
}

/** Identificacao nova: separa fontes e compara cada recorte. */
function identifyBySources(samples: Float32Array, sampleRate: number): string[] {
  return identifySong(samples, sampleRate, { topN: 3 }).result.matches.map((m) => m.species.id);
}

describe('precisao em cena de campo', () => {
  const global = runSceneBench(identifyGlobal);
  const sourced = runSceneBench(identifyBySources);

  const media = (rows: { top1: number; top3: number }[]) => ({
    top1: rows.reduce((s, r) => s + r.top1, 0) / rows.length,
    top3: rows.reduce((s, r) => s + r.top3, 0) / rows.length,
  });
  const mg = media(global);
  const ms = media(sourced);

  it('publica a tabela', () => {
    const rows = global
      .map((r, i) => {
        const n = sourced[i];
        return `  ${r.name.padEnd(22)} ${(r.top1 * 100).toFixed(1).padStart(5)}% ${(r.top3 * 100)
          .toFixed(1)
          .padStart(6)}%  |  ${(n.top1 * 100).toFixed(1).padStart(5)}% ${(n.top3 * 100).toFixed(1).padStart(6)}%`;
      })
      .join('\n');
    console.log(
      `\nCena de campo (${ALL_SPECIES.length} especies x ${SEEDS.length})\n` +
        `  ${'cenario'.padEnd(22)} arquivo inteiro |  por fontes\n` +
        `  ${''.padEnd(22)} top1   top3     |  top1   top3\n${rows}\n` +
        `  ${'MEDIA'.padEnd(22)} ${(mg.top1 * 100).toFixed(1).padStart(5)}% ${(mg.top3 * 100)
          .toFixed(1)
          .padStart(6)}%  |  ${(ms.top1 * 100).toFixed(1).padStart(5)}% ${(ms.top3 * 100).toFixed(1).padStart(6)}%\n`,
    );
    expect(global).toHaveLength(CASES.length);
  });

  it('separar fontes supera a analise do arquivo inteiro', () => {
    expect(ms.top1).toBeGreaterThan(mg.top1);
    expect(ms.top3).toBeGreaterThan(mg.top3);
  });

  it('nao regride no caso simples de uma ave so', () => {
    const simples = sourced[0];
    expect(simples.top1).toBeGreaterThanOrEqual(global[0].top1 - 0.02);
  });
});
