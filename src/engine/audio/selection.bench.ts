import { describe, it } from 'vitest';
import { ALL_SPECIES } from '../../data/species';
import { extractFeatures, type AcousticFeatures } from './features';
import { matchSpecies } from './matcher';
import { analysisWindow } from './recorder';
import { findSources } from './sources';
import { synthesizeScene } from './testing/synth';

/**
 * Diagnostico: o recorte esta sendo GERADO errado ou ESCOLHIDO errado?
 *
 * Sao dois problemas distintos e a correcao de um nao serve para o outro. O
 * oraculo — escolher sempre o recorte que acertou, sabendo a resposta — separa
 * os dois: se o oraculo for alto e a escolha real for baixa, a separacao esta
 * funcionando e falta um criterio de escolha melhor. Se o oraculo tambem for
 * baixo, nenhum criterio salva e o problema esta antes.
 */

const SEEDS = [5, 23];
const CASES = [
  { name: 'so a ave', distractors: 0, snrDb: 20, silence: 2 },
  { name: '1 ao fundo', distractors: 1, snrDb: 15, silence: 2 },
  { name: '2 ao fundo', distractors: 2, snrDb: 12, silence: 2.5 },
  { name: 'quintal', distractors: 3, snrDb: 9, silence: 3 },
];

interface Cand {
  ids: string[];
  fit: number;
  confidence: number;
  noteCount: number;
  durationSec: number;
  separation: number;
  kind: string;
  quality: number;
}

interface Sample {
  truth: string;
  cands: Cand[];
}

function buildCache(): Sample[] {
  const out: Sample[] = [];
  for (const scenario of CASES) {
    ALL_SPECIES.forEach((target, index) => {
      for (const seed of SEEDS) {
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

        const window = analysisWindow(sampleRate);
        const whole = extractFeatures(samples, sampleRate, window);
        const sources = findSources(samples, sampleRate, whole.features.notes, { maxSources: 6 });

        const cands: Cand[] = sources.map((source) => {
          const features: AcousticFeatures =
            source.kind === 'inteiro' ? whole.features : extractFeatures(source.samples, sampleRate, window).features;
          const r = matchSpecies(features, { topN: 3 });
          const sep = r.matches.length > 1 ? r.matches[0].probability - r.matches[1].probability : 1;
          return {
            ids: r.matches.map((m) => m.species.id),
            fit: r.matches[0]?.fit ?? 0,
            confidence: r.confidence,
            noteCount: features.noteCount,
            durationSec: features.durationSec,
            separation: sep,
            kind: source.kind,
            quality: features.signalQuality,
          };
        });
        out.push({ truth: target.id, cands });
      }
    });
  }
  return out;
}

function score(cache: Sample[], pick: (c: Cand[]) => Cand) {
  let t1 = 0;
  let t3 = 0;
  for (const s of cache) {
    const c = pick(s.cands);
    if (c.ids[0] === s.truth) t1++;
    if (c.ids.includes(s.truth)) t3++;
  }
  return { top1: t1 / cache.length, top3: t3 / cache.length };
}

describe('geracao x escolha de recorte', () => {
  const cache = buildCache();

  it('compara criterios de escolha contra o oraculo', () => {
    const best = (fn: (c: Cand) => number) => (cands: Cand[]) =>
      cands.reduce((a, b) => (fn(b) > fn(a) ? b : a));

    // Evidencia: quanto o recorte tem para dizer. Poucas notas casam bem com
    // qualquer coisa, entao aderencia alta num fragmento minusculo nao vale.
    const evidence = (c: Cand) => Math.min(1, (c.noteCount - 1) / 9) * Math.min(1, c.durationSec / 2.5);

    const criterios: { nome: string; pick: (c: Cand[]) => Cand }[] = [
      { nome: 'so o inteiro (atual)', pick: (c) => c.find((x) => x.kind === 'inteiro') ?? c[0] },
      { nome: 'maior aderencia', pick: best((c) => c.fit) },
      { nome: 'maior confianca', pick: best((c) => c.confidence) },
      { nome: 'aderencia x evidencia', pick: best((c) => c.fit * evidence(c)) },
      { nome: 'aderencia x separacao', pick: best((c) => c.fit * c.separation) },
      { nome: 'ader x evid x separ', pick: best((c) => c.fit * evidence(c) * (0.4 + c.separation)) },
      { nome: 'ader x evid x qualidade', pick: best((c) => c.fit * evidence(c) * (0.3 + c.quality)) },
      { nome: 'mais notas', pick: best((c) => c.noteCount) },
    ];

    console.log('\nCriterio de escolha do recorte (58 especies x 2 x 4 cenarios)');
    for (const { nome, pick } of criterios) {
      const r = score(cache, pick);
      console.log(`  ${nome.padEnd(24)} top1 ${(r.top1 * 100).toFixed(1).padStart(5)}%  top3 ${(r.top3 * 100).toFixed(1).padStart(5)}%`);
    }

    // Oraculo: escolhe sabendo a resposta. E o teto do que a separacao permite.
    let o1 = 0;
    let o3 = 0;
    for (const s of cache) {
      if (s.cands.some((c) => c.ids[0] === s.truth)) o1++;
      if (s.cands.some((c) => c.ids.includes(s.truth))) o3++;
    }
    console.log(
      `  ${'ORACULO (teto)'.padEnd(24)} top1 ${((o1 / cache.length) * 100).toFixed(1).padStart(5)}%  top3 ${((o3 / cache.length) * 100).toFixed(1).padStart(5)}%\n`,
    );

    const kinds = new Map<string, number>();
    for (const s of cache) for (const c of s.cands) kinds.set(c.kind, (kinds.get(c.kind) ?? 0) + 1);
    console.log('  recortes gerados:', [...kinds].map(([k, v]) => `${k}=${(v / cache.length).toFixed(1)}`).join(' '));
  });
});
