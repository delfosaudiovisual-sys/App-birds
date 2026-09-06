import { clamp01, type AcousticFeatures } from './features';

/**
 * Classificacao funcional da vocalizacao.
 *
 * A inferencia e ESTRUTURAL: nao existe como saber a intencao da ave, mas
 * decadas de bioacustica mostram que a funcao deixa assinatura fisica no sinal,
 * porque cada funcao tem uma pressao seletiva diferente:
 *
 *  - territorio: precisa viajar longe e ser reconhecivel -> frases longas,
 *    estereotipadas, repetidas em intervalo regular, tom relativamente puro
 *    (tom puro sofre menos atenuacao/reverberacao na vegetacao).
 *  - corte: e um sinal honesto de qualidade -> complexidade maxima, repertorio
 *    grande, trinados rapidos e de banda larga (dificeis de executar), crescendo.
 *  - alarme: dois arquetipos opostos. O "seet" agudo e de banda estreita e
 *    dificil de localizar (serve pra avisar sem se entregar); o de mobbing e
 *    aspero, curto e de banda larga, feito exatamente pra ser localizavel e
 *    juntar o bando em cima do predador.
 *  - alimento: insistente e monotono -> repeticao rapida e regular, som aspero,
 *    ciclo de trabalho alto, amplitude crescente (filhote ou pedido ativo).
 *  - contato: barato e curto -> uma ou duas notas, banda estreita, pouco
 *    repetidas, so pra manter coesao do bando.
 */
export type SongTypeId = 'territorio' | 'corte' | 'alarme' | 'alimento' | 'contato';

export interface SongTypeInfo {
  id: SongTypeId;
  label: string;
  short: string;
  description: string;
  color: string;
  icon: string;
}

export const SONG_TYPES: Record<SongTypeId, SongTypeInfo> = {
  territorio: {
    id: 'territorio',
    label: 'Demarcacao de territorio',
    short: 'Territorio',
    description:
      'Canto de proclamacao: frases longas e estereotipadas, repetidas em intervalo regular, projetadas para atravessar a vegetacao e avisar rivais de que o lugar esta ocupado.',
    color: '#e07a3c',
    icon: 'flag',
  },
  corte: {
    id: 'corte',
    label: 'Corte / atracao de femeas',
    short: 'Corte',
    description:
      'Canto de exibicao: o mais elaborado do repertorio. Repertorio amplo, modulacao rapida e trinados de banda larga funcionam como sinal honesto de vigor fisico.',
    color: '#d24d8c',
    icon: 'heart',
  },
  alarme: {
    id: 'alarme',
    label: 'Alarme / predador',
    short: 'Alarme',
    description:
      'Aviso de perigo. Ou muito agudo e de banda estreita (dificil de localizar), ou aspero, curto e repetido (chamando o bando para expulsar o predador).',
    color: '#d93b3b',
    icon: 'alert',
  },
  alimento: {
    id: 'alimento',
    label: 'Alimento / pedido de comida',
    short: 'Alimento',
    description:
      'Vocalizacao insistente e monotona ligada a alimentacao: pedido de filhote, chamado de oferta ao parceiro ou sinalizacao de fonte de comida.',
    color: '#3f9c5a',
    icon: 'seed',
  },
  contato: {
    id: 'contato',
    label: 'Contato / coesao de bando',
    short: 'Contato',
    description:
      'Nota curta e barata, emitida para manter o casal ou o bando em contato durante o deslocamento e o forrageio.',
    color: '#4a8fd4',
    icon: 'link',
  },
};

export interface Evidence {
  /** rotulo curto pra UI */
  label: string;
  /** valor medido, ja formatado */
  measured: string;
  /** contribuicao -1..1 (positiva sustenta a hipotese) */
  weight: number;
}

export interface SongTypeScore {
  type: SongTypeId;
  probability: number;
  evidence: Evidence[];
}

export interface SongTypeResult {
  scores: SongTypeScore[];
  top: SongTypeScore;
  /** 0-1: quanta confianca ter na leitura funcional em si */
  confidence: number;
  /** avisos (sinal curto, ruidoso, etc.) */
  caveats: string[];
}

/** 1 dentro de [lo,hi], caindo suavemente fora numa largura `tol`. */
function band(value: number, lo: number, hi: number, tol: number): number {
  if (value >= lo && value <= hi) return 1;
  const d = value < lo ? lo - value : value - hi;
  return clamp01(1 - d / tol);
}

/** rampa linear de 0 em `at0` ate 1 em `at1` (funciona nos dois sentidos). */
function ramp(value: number, at0: number, at1: number): number {
  if (at1 === at0) return value >= at1 ? 1 : 0;
  return clamp01((value - at0) / (at1 - at0));
}

interface Term {
  label: string;
  measured: string;
  score: number;
  weight: number;
}

function combine(terms: Term[]): { score: number; evidence: Evidence[] } {
  let total = 0;
  let weightSum = 0;
  for (const t of terms) {
    total += t.score * t.weight;
    weightSum += t.weight;
  }
  const score = weightSum > 0 ? total / weightSum : 0;
  const evidence = terms
    .map((t) => ({
      label: t.label,
      measured: t.measured,
      // centraliza em 0: acima de 0.5 sustenta, abaixo enfraquece
      weight: (t.score - 0.5) * 2 * (t.weight / Math.max(1, Math.max(...terms.map((x) => x.weight)))),
    }))
    .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight))
    .slice(0, 5);
  return { score, evidence };
}


const khz = (v: number) => `${(v / 1000).toFixed(1)} kHz`;
const pct = (v: number) => `${Math.round(v * 100)}%`;
const sec = (v: number) => `${v.toFixed(2)} s`;

function scoreTerritorio(f: AcousticFeatures) {
  return combine([
    {
      label: 'Repeticao regular da frase',
      measured: pct(f.phraseRepetition),
      score: ramp(f.phraseRepetition, 0.15, 0.6),
      weight: 2.2,
    },
    {
      label: 'Frase estereotipada (repeticoes identicas)',
      measured: pct(f.stereotypy),
      score: ramp(f.stereotypy, 0.35, 0.8),
      weight: 2.0,
    },
    {
      label: 'Duracao da frase',
      measured: sec(f.phraseDurationSec),
      score: band(f.phraseDurationSec, 0.6, 5.0, 2.5),
      weight: 1.5,
    },
    {
      label: 'Tom puro (viaja melhor na mata)',
      measured: pct(f.tonality),
      score: ramp(f.tonality, 0.25, 0.7),
      weight: 1.2,
    },
    {
      label: 'Frequencia de projecao (1,5-5 kHz)',
      measured: khz(f.peakHz),
      score: band(f.peakHz, 1500, 5000, 2200),
      weight: 1.3,
    },
    {
      label: 'Ritmo de emissao moderado',
      measured: `${f.noteRate.toFixed(1)} notas/s`,
      score: band(f.noteRate, 0.8, 7, 5),
      weight: 1.0,
    },
    {
      label: 'Emissao sustentada, nao esporadica',
      measured: pct(f.dutyCycle),
      score: band(f.dutyCycle, 0.15, 0.75, 0.3),
      weight: 0.9,
    },
    {
      label: 'Sinal forte (canto de broadcast)',
      measured: `${f.snrDb.toFixed(0)} dB`,
      score: ramp(f.snrDb, 6, 22),
      weight: 0.8,
    },
  ]);
}

function scoreCorte(f: AcousticFeatures) {
  // "Vocal performance": trinado rapido E de banda larga ao mesmo tempo e
  // fisicamente dificil (limite de desempenho vocal) e e justamente o que as
  // femeas usam pra avaliar o macho.
  const performance = clamp01(f.trillIndex * ramp(f.bandwidthHz, 800, 3500));
  return combine([
    {
      label: 'Repertorio de notas distintas',
      measured: pct(f.noteDiversity),
      score: ramp(f.noteDiversity, 0.2, 0.75),
      weight: 2.3,
    },
    {
      label: 'Desempenho vocal (trinado largo e rapido)',
      measured: pct(performance),
      score: ramp(performance, 0.1, 0.6),
      weight: 2.0,
    },
    {
      label: 'Modulacao de frequencia dentro das notas',
      measured: pct(f.fmDepth),
      score: ramp(f.fmDepth, 0.12, 0.55),
      weight: 1.7,
    },
    {
      label: 'Largura de banda ocupada',
      measured: khz(f.bandwidthHz),
      score: ramp(f.bandwidthHz, 900, 4000),
      weight: 1.4,
    },
    {
      label: 'Velocidade de execucao',
      measured: `${f.noteRate.toFixed(1)} notas/s`,
      score: ramp(f.noteRate, 2.5, 12),
      weight: 1.3,
    },
    {
      label: 'Trecho longo e elaborado',
      measured: sec(f.durationSec * f.dutyCycle),
      score: ramp(f.durationSec * f.dutyCycle, 0.7, 4),
      weight: 1.1,
    },
    {
      label: 'Crescendo de intensidade',
      measured: f.amplitudeTrend >= 0 ? `+${pct(f.amplitudeTrend)}` : pct(f.amplitudeTrend),
      score: ramp(f.amplitudeTrend, -0.3, 0.5),
      weight: 0.8,
    },
    {
      label: 'Riqueza melodica (contorno variado)',
      measured: `${f.fmRateHz.toFixed(1)} inflexoes/s`,
      score: ramp(f.fmRateHz, 1, 10),
      weight: 1.2,
    },
  ]);
}

function scoreAlarme(f: AcousticFeatures) {
  // Arquetipo 1 - "seet": agudo, estreito, curto, dificil de localizar.
  const seet = combine([
    {
      label: 'Frequencia muito aguda (6-10 kHz)',
      measured: khz(f.peakHz),
      score: band(f.peakHz, 6000, 10000, 2000),
      weight: 2.6,
    },
    {
      label: 'Banda estreita (dificil de localizar)',
      measured: khz(f.bandwidthHz),
      score: 1 - ramp(f.bandwidthHz, 700, 2500),
      weight: 2.0,
    },
    {
      label: 'Notas muito curtas',
      measured: sec(f.noteDurationMean),
      score: 1 - ramp(f.noteDurationMean, 0.1, 0.45),
      weight: 1.5,
    },
    {
      label: 'Tom fino e limpo',
      measured: pct(f.tonality),
      score: ramp(f.tonality, 0.3, 0.75),
      weight: 1.2,
    },
    {
      label: 'Emissao esparsa',
      measured: pct(f.dutyCycle),
      score: 1 - ramp(f.dutyCycle, 0.2, 0.6),
      weight: 0.9,
    },
  ]);

  // Arquetipo 2 - mobbing: aspero, banda larga, ataque abrupto, repetido.
  const mobbing = combine([
    {
      label: 'Som aspero / ruidoso',
      measured: pct(1 - f.tonality),
      score: 1 - ramp(f.tonality, 0.15, 0.6),
      weight: 2.2,
    },
    {
      label: 'Ataque abrupto (facil de localizar)',
      measured: pct(f.onsetSharpness),
      score: ramp(f.onsetSharpness, 0.2, 0.7),
      weight: 2.0,
    },
    {
      label: 'Notas muito curtas e repetidas',
      measured: `${f.noteRate.toFixed(1)} notas/s`,
      score: ramp(f.noteRate, 3, 12) * (1 - ramp(f.noteDurationMean, 0.12, 0.4)),
      weight: 2.0,
    },
    {
      label: 'Banda larga',
      measured: khz(f.bandwidthHz),
      score: ramp(f.bandwidthHz, 1500, 5000),
      weight: 1.6,
    },
    {
      label: 'Entropia espectral alta',
      measured: pct(f.entropy),
      score: ramp(f.entropy, 0.45, 0.85),
      weight: 1.3,
    },
    {
      label: 'Emissao em rajada irregular',
      measured: pct(f.rhythmIrregularity),
      score: band(f.rhythmIrregularity, 0.15, 0.7, 0.35),
      weight: 0.9,
    },
  ]);

  return seet.score >= mobbing.score
    ? { score: seet.score, evidence: seet.evidence, subtype: 'agudo de esconderijo' }
    : { score: mobbing.score, evidence: mobbing.evidence, subtype: 'mobbing / expulsao' };
}

function scoreAlimento(f: AcousticFeatures) {
  return combine([
    {
      label: 'Repeticao insistente e regular',
      measured: `${f.noteRate.toFixed(1)} notas/s`,
      score: band(f.noteRate, 2.5, 11, 4) * (1 - ramp(f.rhythmIrregularity, 0.3, 0.8)),
      weight: 2.3,
    },
    {
      label: 'Ciclo de emissao alto (nao para)',
      measured: pct(f.dutyCycle),
      score: ramp(f.dutyCycle, 0.25, 0.7),
      weight: 2.0,
    },
    {
      label: 'Som aspero / esganicado',
      measured: pct(1 - f.tonality),
      score: 1 - ramp(f.tonality, 0.2, 0.65),
      weight: 1.8,
    },
    {
      label: 'Monotonia (repertorio minimo)',
      measured: pct(1 - f.noteDiversity),
      score: 1 - ramp(f.noteDiversity, 0.15, 0.6),
      weight: 1.7,
    },
    {
      label: 'Pouca modulacao dentro da nota',
      measured: pct(f.fmDepth),
      score: 1 - ramp(f.fmDepth, 0.15, 0.5),
      weight: 1.3,
    },
    {
      label: 'Intensidade crescente (insistencia)',
      measured: f.amplitudeTrend >= 0 ? `+${pct(f.amplitudeTrend)}` : pct(f.amplitudeTrend),
      score: ramp(f.amplitudeTrend, -0.2, 0.4),
      weight: 1.2,
    },
    {
      label: 'Faixa media (2-6 kHz)',
      measured: khz(f.peakHz),
      score: band(f.peakHz, 2000, 6000, 2000),
      weight: 0.9,
    },
  ]);
}

function scoreContato(f: AcousticFeatures) {
  return combine([
    {
      label: 'Poucas notas isoladas',
      measured: `${f.noteCount} nota(s)`,
      score: band(f.noteCount, 1, 4, 3),
      weight: 2.2,
    },
    {
      label: 'Emissao esparsa, baixo custo',
      measured: pct(f.dutyCycle),
      score: 1 - ramp(f.dutyCycle, 0.12, 0.45),
      weight: 2.0,
    },
    {
      label: 'Banda estreita',
      measured: khz(f.bandwidthHz),
      score: 1 - ramp(f.bandwidthHz, 700, 2800),
      weight: 1.6,
    },
    {
      label: 'Estrutura simples (sem repertorio)',
      measured: pct(1 - f.noteDiversity),
      score: 1 - ramp(f.noteDiversity, 0.1, 0.5),
      weight: 1.5,
    },
    {
      label: 'Sem repeticao de frase longa',
      measured: pct(f.phraseRepetition),
      score: 1 - ramp(f.phraseRepetition, 0.2, 0.65),
      weight: 1.3,
    },
    {
      label: 'Nota curta',
      measured: sec(f.noteDurationMean),
      score: 1 - ramp(f.noteDurationMean, 0.25, 0.9),
      weight: 1.1,
    },
    {
      label: 'Modulacao contida',
      measured: pct(f.fmDepth),
      score: 1 - ramp(f.fmDepth, 0.2, 0.6),
      weight: 0.8,
    },
  ]);
}

/**
 * Prior por especie: quando se sabe qual funcao domina o repertorio conhecido
 * daquela ave, ele desempata sem sequestrar a leitura acustica (peso baixo).
 */
export type SongTypePrior = Partial<Record<SongTypeId, number>>;

const SOFTMAX_TEMPERATURE = 0.16;
const PRIOR_WEIGHT = 0.22;

export function classifySongType(f: AcousticFeatures, prior?: SongTypePrior): SongTypeResult {
  const territorio = scoreTerritorio(f);
  const corte = scoreCorte(f);
  const alarme = scoreAlarme(f);
  const alimento = scoreAlimento(f);
  const contato = scoreContato(f);

  const raw: Record<SongTypeId, { score: number; evidence: Evidence[] }> = {
    territorio,
    corte,
    alarme: { score: alarme.score, evidence: alarme.evidence },
    alimento,
    contato,
  };

  const ids = Object.keys(raw) as SongTypeId[];

  // Mistura com o prior da especie antes do softmax.
  const blended = ids.map((id) => {
    const p = prior?.[id];
    const base = raw[id].score;
    return p === undefined ? base : base * (1 - PRIOR_WEIGHT) + p * PRIOR_WEIGHT;
  });

  const max = Math.max(...blended);
  const exps = blended.map((s) => Math.exp((s - max) / SOFTMAX_TEMPERATURE));
  const sum = exps.reduce((a, b) => a + b, 0);

  const scores: SongTypeScore[] = ids
    .map((id, i) => ({
      type: id,
      probability: exps[i] / sum,
      evidence: raw[id].evidence,
    }))
    .sort((a, b) => b.probability - a.probability);

  const caveats: string[] = [];
  if (f.signalQuality < 0.35) caveats.push('Sinal fraco ou ruidoso: a leitura funcional fica instavel.');
  if (f.noteCount < 2) caveats.push('Poucas notas capturadas — grave um trecho mais longo para separar funcao de contato e alarme.');
  if (f.durationSec < 2) caveats.push('Trecho curto: repeticao de frase nao pode ser medida com seguranca.');
  if (alarme.score === Math.max(...ids.map((id) => raw[id].score))) {
    caveats.push(`Padrao de alarme do tipo "${alarme.subtype}".`);
  }

  // Confianca = separacao entre 1o e 2o lugar, temperada pela qualidade do
  // sinal E pela quantidade de evidencia disponivel. Uma unica nota de 100 ms
  // pode separar bem as hipoteses e ainda assim nao autorizar conclusao
  // nenhuma: repeticao de frase, estereotipia e repertorio simplesmente nao
  // sao mensuraveis nesse trecho.
  const separation = scores[0].probability - scores[1].probability;
  const evidence = clamp01(
    0.45 * clamp01((f.noteCount - 1) / 7) +
      0.35 * clamp01((f.durationSec * Math.max(f.dutyCycle, 0.05) - 0.2) / 1.8) +
      0.2 * clamp01(f.durationSec / 5),
  );
  const confidence =
    clamp01(0.35 + separation * 0.9) *
    clamp01(0.4 + f.signalQuality * 0.75) *
    clamp01(0.35 + evidence * 0.75);

  return { scores, top: scores[0], confidence, caveats };
}
