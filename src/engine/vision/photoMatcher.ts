import { ALL_SPECIES } from '../../data/species';
import type { Species } from '../../data/types';
import { colorSimilarity, hexToLab, type Lab } from './color';
import type { ImageFeatures } from './imageFeatures';

export interface PhotoMatch {
  species: Species;
  probability: number;
  fit: number;
  reasons: { label: string; ok: boolean; detail: string }[];
}

export interface PhotoMatchResult {
  matches: PhotoMatch[];
  confidence: number;
  inconclusive: boolean;
  notes: string[];
  /** quando um modelo externo participou, fica registrado aqui */
  assistedBy?: string;
}

/**
 * Casamento de paletas no espirito do Earth Mover's Distance: cada cor da
 * paleta observada procura a cor mais parecida do perfil da especie e a
 * similaridade e ponderada pela participacao de cada cor. Assim uma mancha
 * pequena e muito caracteristica (o bico laranja do tucano) conta, mas nao
 * domina o resultado.
 */
function paletteSimilarity(observed: { lab: Lab; share: number }[], reference: { lab: Lab; share: number }[]): number {
  if (observed.length === 0 || reference.length === 0) return 0;

  let forward = 0;
  let wf = 0;
  for (const o of observed) {
    let best = 0;
    for (const r of reference) best = Math.max(best, colorSimilarity(o.lab, r.lab));
    forward += best * o.share;
    wf += o.share;
  }

  let backward = 0;
  let wb = 0;
  for (const r of reference) {
    let best = 0;
    for (const o of observed) best = Math.max(best, colorSimilarity(o.lab, r.lab));
    backward += best * r.share;
    wb += r.share;
  }

  const f = wf > 0 ? forward / wf : 0;
  const b = wb > 0 ? backward / wb : 0;
  // media harmonica: penaliza casamento so num sentido (foto verde x ave que
  // tem um pouco de verde entre muitas outras cores)
  return f + b > 0 ? (2 * f * b) / (f + b) : 0;
}

const PATTERN_EDGE_EXPECTATION: Record<Species['visual']['pattern'], number> = {
  uniforme: 0.15,
  bicolor: 0.3,
  capuz: 0.35,
  mascarado: 0.45,
  manchado: 0.6,
  listrado: 0.72,
  barrado: 0.85,
};

const SILHOUETTE_ASPECT: Record<Species['visual']['silhouette'], number> = {
  passeriforme: 1.15,
  psitacideo: 1.35,
  tucano: 1.7,
  rapinante: 1.2,
  coruja: 0.95,
  aquatica: 1.4,
  pernalta: 0.85,
  columbiforme: 1.3,
  'beija-flor': 1.5,
  terrestre: 1.1,
};

interface Term {
  label: string;
  score: number;
  weight: number;
  detail: string;
}

function scoreSpecies(f: ImageFeatures, species: Species): { fit: number; terms: Term[] } {
  const v = species.visual;
  const reference = v.palette.map((p) => ({ lab: hexToLab(p.hex), share: p.share }));
  const observed = f.palette.map((p) => ({ lab: p.lab, share: p.share }));

  // Faixas: cabeca/peito/ventre observados contra as regioes declaradas.
  const regionRef = {
    top: v.palette.filter((p) => p.region === 'cabeca' || p.region === 'bico'),
    mid: v.palette.filter((p) => p.region === 'peito' || p.region === 'dorso' || p.region === 'asa'),
    bottom: v.palette.filter((p) => p.region === 'ventre' || p.region === 'cauda'),
  };
  const bandScore = (band: { lab: Lab } | undefined, refs: typeof v.palette): number | null => {
    if (!band || refs.length === 0) return null;
    let best = 0;
    for (const r of refs) best = Math.max(best, colorSimilarity(band.lab, hexToLab(r.hex)));
    return best;
  };
  const bandScores = [
    bandScore(f.bands[0], regionRef.top),
    bandScore(f.bands[1], regionRef.mid),
    bandScore(f.bands[2], regionRef.bottom),
  ].filter((s): s is number => s !== null);

  const expectedEdges = PATTERN_EDGE_EXPECTATION[v.pattern];
  const patternScore = Math.max(0, 1 - Math.abs(f.edgeDensity - expectedEdges) / 0.55);

  const bandingExpected = v.pattern === 'barrado' || v.pattern === 'listrado' ? 0.65 : 0.25;
  const bandingScore = Math.max(0, 1 - Math.abs(f.banding - bandingExpected) / 0.7);

  const expectedAspect = SILHOUETTE_ASPECT[v.silhouette];
  const aspectScore = Math.max(0, 1 - Math.abs(Math.log2(f.aspectRatio / expectedAspect)) / 1.4);

  const contrastScore = Math.max(0, 1 - Math.abs(f.contrast - v.contrast) / 0.75);

  const terms: Term[] = [
    {
      label: 'Paleta de plumagem',
      score: paletteSimilarity(observed, reference),
      weight: 4.2,
      detail: `${f.palette.slice(0, 3).map((p) => p.hex).join(', ')} vs ${v.palette
        .slice(0, 3)
        .map((p) => p.hex)
        .join(', ')}`,
    },
    {
      label: 'Distribuicao das cores no corpo',
      score: bandScores.length ? bandScores.reduce((a, b) => a + b, 0) / bandScores.length : 0.5,
      weight: 2.4,
      detail: 'cabeca / dorso e peito / ventre comparados separadamente',
    },
    {
      label: 'Padrao da plumagem',
      score: patternScore,
      weight: 1.8,
      detail: `textura medida ${(f.edgeDensity * 100).toFixed(0)}%, esperado para "${v.pattern}" ~${(
        expectedEdges * 100
      ).toFixed(0)}%`,
    },
    {
      label: 'Barras e listras',
      score: bandingScore,
      weight: 1.1,
      detail: `periodicidade ${(f.banding * 100).toFixed(0)}%`,
    },
    {
      label: 'Contraste geral',
      score: contrastScore,
      weight: 1.2,
      detail: `${(f.contrast * 100).toFixed(0)}% vs ${(v.contrast * 100).toFixed(0)}% esperados`,
    },
    {
      label: 'Silhueta',
      score: aspectScore,
      weight: 1.0,
      detail: `proporcao ${f.aspectRatio.toFixed(2)} vs ~${expectedAspect} de "${v.silhouette}"`,
    },
  ];

  let num = 0;
  let den = 0;
  for (const t of terms) {
    num += t.score * t.weight;
    den += t.weight;
  }
  return { fit: den > 0 ? num / den : 0, terms };
}

const SOFTMAX_TEMPERATURE = 0.05;
const INCONCLUSIVE_FIT = 0.55;

export interface PhotoMatchOptions {
  topN?: number;
  /**
   * Reforco vindo de um classificador externo (CNN local ou modelo em nuvem):
   * multiplicadores por id de especie ou por familia.
   */
  boost?: { bySpecies?: Record<string, number>; byFamily?: Record<string, number>; source?: string };
}

export function matchPhoto(f: ImageFeatures, options: PhotoMatchOptions = {}): PhotoMatchResult {
  const topN = options.topN ?? 5;
  const boost = options.boost;

  const scored = ALL_SPECIES.map((species) => {
    const { fit, terms } = scoreSpecies(f, species);
    let adjusted = fit;
    if (boost) {
      const bySpecies = boost.bySpecies?.[species.id] ?? 0;
      const byFamily = boost.byFamily?.[species.family] ?? 0;
      // reforco entra como bonus limitado: o modelo externo inclina, nao decide
      adjusted = Math.min(1, fit + Math.max(bySpecies, byFamily) * 0.22);
    }
    const sorted = [...terms].sort((a, b) => b.score * b.weight - a.score * a.weight);
    const reasons = [
      ...sorted.slice(0, 3).map((t) => ({ label: t.label, ok: t.score >= 0.6, detail: t.detail })),
      ...sorted
        .slice(-2)
        .filter((t) => t.score < 0.5)
        .map((t) => ({ label: t.label, ok: false, detail: t.detail })),
    ];
    return { species, fit: adjusted, reasons };
  });

  scored.sort((a, b) => b.fit - a.fit);
  const head = scored.slice(0, topN);

  const max = head[0]?.fit ?? 0;
  const exps = head.map((s) => Math.exp((s.fit - max) / SOFTMAX_TEMPERATURE));
  const sum = exps.reduce((a, b) => a + b, 0) || 1;

  const matches: PhotoMatch[] = head.map((s, i) => ({
    species: s.species,
    probability: exps[i] / sum,
    fit: s.fit,
    reasons: s.reasons,
  }));

  const notes: string[] = [];
  if (f.separability < 0.3) {
    notes.push('A ave se confunde com o fundo. Tente uma foto com o passaro maior no quadro.');
  }
  if (f.subjectShare < 0.06) {
    notes.push('O passaro ocupa pouco espaco na foto: aproxime ou corte a imagem antes de enviar.');
  }
  if (matches.length > 1 && matches[0].probability - matches[1].probability < 0.1) {
    notes.push(`Muito parecido com ${matches[1].species.commonName} pela cor; confirme pelo canto.`);
  }

  const inconclusive = max < INCONCLUSIVE_FIT || f.separability < 0.18;
  if (inconclusive) notes.push('Identificacao visual sem conclusao segura — grave o canto para confirmar.');

  const separation = matches.length > 1 ? matches[0].probability - matches[1].probability : 1;
  const confidence = Math.max(
    0,
    Math.min(1, max * 0.55 + separation * 0.2 + f.separability * 0.15 + Math.min(1, f.subjectShare * 4) * 0.1),
  );

  return { matches, confidence, inconclusive, notes, assistedBy: boost?.source };
}
