import { clamp01, type AcousticFeatures } from './features';
import { dtwSimilarity } from './matcher';

/**
 * Aprendizado por exemplos: o app guarda o que VOCE confirmou e passa a
 * comparar com isso.
 *
 * Por que isto existe: os perfis acusticos da base foram escritos a mao, com
 * faixas largas o bastante para cobrir a variacao de cada especie, e por isso
 * se sobrepoem muito — o banco de provas mostrou que nenhuma caracteristica
 * isolada passa de 7% de acerto. Uma gravacao REAL da ave, etiquetada por
 * quem a ouviu, e uma descricao infinitamente mais precisa do que qualquer
 * faixa que eu escreva: ela carrega o timbre daquele individuo, o dialeto
 * daquela regiao e o jeito daquela ave cantar.
 *
 * E o unico caminho de precisao alta que funciona offline e sem depender de
 * modelo externo — o app fica melhor exatamente nas aves do seu quintal, que
 * sao as que voce vai gravar de novo.
 */

/** Vetor compacto e comparavel de um canto. */
export interface ExemplarVector {
  /** grandezas em escala logaritmica: a percepcao delas e proporcional */
  logPeakHz: number;
  logBandwidth: number;
  logNoteRate: number;
  logNoteDuration: number;
  logPhraseSec: number;
  /** grandezas ja em 0-1 */
  tonality: number;
  fmDepth: number;
  trillIndex: number;
  rhythmIrregularity: number;
  noteDiversity: number;
  harmonicity: number;
  /** desenho de altura, para alinhamento temporal */
  contour: number[];
}

export interface Exemplar {
  id: string;
  speciesId: string;
  vector: ExemplarVector;
  createdAt: number;
  /** true quando o usuario corrigiu o palpite do app, e nao apenas confirmou */
  corrected: boolean;
}

const safeLog2 = (v: number, floor: number) => Math.log2(Math.max(v, floor));

export function toVector(features: AcousticFeatures): ExemplarVector {
  return {
    logPeakHz: safeLog2(features.peakHz, 100),
    logBandwidth: safeLog2(features.bandwidthHz, 50),
    logNoteRate: safeLog2(features.noteRate, 0.1),
    logNoteDuration: safeLog2(features.noteDurationMean, 0.005),
    logPhraseSec: safeLog2(features.phraseDurationSec, 0.05),
    tonality: features.tonality,
    fmDepth: features.fmDepth,
    trillIndex: features.trillIndex,
    rhythmIrregularity: features.rhythmIrregularity,
    noteDiversity: features.noteDiversity,
    harmonicity: features.harmonicity,
    contour: features.melodyContour,
  };
}

/**
 * Tolerancia de cada dimensao: quanto ela pode variar entre duas gravacoes da
 * MESMA ave sem que deixem de ser a mesma ave.
 *
 * As logaritmicas estao em oitavas — meia oitava de diferenca de altura ainda e
 * a mesma especie cantando mais agudo; duas oitavas nao e. As demais estao na
 * propria escala 0-1.
 */
const TOLERANCE: Record<keyof Omit<ExemplarVector, 'contour'>, number> = {
  logPeakHz: 0.55,
  logBandwidth: 1.1,
  logNoteRate: 0.9,
  logNoteDuration: 0.9,
  logPhraseSec: 1.4,
  tonality: 0.3,
  fmDepth: 0.35,
  trillIndex: 0.35,
  rhythmIrregularity: 0.4,
  noteDiversity: 0.45,
  harmonicity: 0.4,
};

const WEIGHT: Record<keyof Omit<ExemplarVector, 'contour'>, number> = {
  logPeakHz: 3.0,
  logBandwidth: 1.2,
  logNoteRate: 2.2,
  logNoteDuration: 2.0,
  logPhraseSec: 1.0,
  tonality: 2.2,
  fmDepth: 1.4,
  trillIndex: 1.2,
  rhythmIrregularity: 1.0,
  noteDiversity: 1.0,
  harmonicity: 0.8,
};

const CONTOUR_WEIGHT = 2.0;

/**
 * Semelhanca 0-1 entre duas gravacoes.
 *
 * Cada dimensao vira uma nota de 0 a 1 pela distancia relativa a sua
 * tolerancia, e a combinacao e a media ponderada. Nao ha patamar aqui, ao
 * contrario da comparacao com os perfis: um exemplar e um PONTO, nao uma faixa,
 * entao distancia ao ponto e exatamente o que interessa.
 */
export function vectorSimilarity(a: ExemplarVector, b: ExemplarVector): number {
  let sum = 0;
  let weightSum = 0;

  for (const key of Object.keys(TOLERANCE) as (keyof typeof TOLERANCE)[]) {
    const distance = Math.abs(a[key] - b[key]);
    const score = clamp01(1 - distance / TOLERANCE[key]);
    sum += score * WEIGHT[key];
    weightSum += WEIGHT[key];
  }

  sum += dtwSimilarity(a.contour, b.contour) * CONTOUR_WEIGHT;
  weightSum += CONTOUR_WEIGHT;

  return weightSum > 0 ? sum / weightSum : 0;
}

export interface ExemplarMatch {
  speciesId: string;
  /** semelhanca com o exemplar mais parecido daquela especie */
  similarity: number;
  /** quantos exemplares daquela especie existem */
  count: number;
}

/**
 * Melhor semelhanca por especie entre todos os exemplares guardados.
 *
 * Fica com o MAXIMO, nao a media: uma especie costuma ter varios cantos
 * diferentes no repertorio, e parecer com um deles ja basta. A media puniria
 * exatamente a ave de repertorio rico.
 */
export function matchExemplars(features: AcousticFeatures, exemplars: Exemplar[]): Map<string, ExemplarMatch> {
  const vector = toVector(features);
  const best = new Map<string, ExemplarMatch>();

  for (const exemplar of exemplars) {
    const similarity = vectorSimilarity(vector, exemplar.vector);
    const current = best.get(exemplar.speciesId);
    if (!current) {
      best.set(exemplar.speciesId, { speciesId: exemplar.speciesId, similarity, count: 1 });
    } else {
      current.count += 1;
      if (similarity > current.similarity) current.similarity = similarity;
    }
  }

  return best;
}

/**
 * Piso e teto do reforco por exemplar.
 *
 * A calibracao veio de medicao, e ela obriga a ser conservador: comparando
 * gravacoes duas a duas, a semelhanca entre a MESMA especie tem mediana 0,60 e
 * entre especies DIFERENTES tem p90 de 0,60 e maximo de 0,83. As duas
 * distribuicoes se sobrepoem quase por completo.
 *
 * Por isso o exemplar NAO substitui a aderencia ao perfil. Se substituisse,
 * uma especie errada com semelhanca 0,8 passaria por cima de um perfil correto,
 * e o app ficaria pior quanto mais o usuario o usasse — o oposto do que se
 * espera de aprendizado. Ele entra como um bonus limitado, capaz de desempatar
 * candidatos proximos e incapaz de sequestrar o resultado.
 *
 * Vale o registro de uma limitacao do banco de provas: o sintetizador sorteia,
 * a cada gravacao, valores novos dentro de TODA a faixa do perfil da especie.
 * Uma ave real canta de forma muito mais constante que isso, entao a medicao
 * acima subestima o quanto o exemplar ajudaria na pratica. Nao da para provar
 * o ganho real sem gravacoes de campo etiquetadas — dai o bonus ser modesto.
 */
export const EXEMPLAR_FLOOR = 0.6;
export const EXEMPLAR_MAX_BONUS = 0.08;

export function blendWithExemplar(profileFit: number, match: ExemplarMatch | undefined): number {
  if (!match || match.similarity < EXEMPLAR_FLOOR) return profileFit;
  const bonus = Math.min(EXEMPLAR_MAX_BONUS, (match.similarity - EXEMPLAR_FLOOR) * 0.4);
  return Math.min(1, profileFit + bonus);
}
