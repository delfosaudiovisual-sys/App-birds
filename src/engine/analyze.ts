import type { AcousticFeatures } from './audio/features';
import { matchSpecies, type MatchResult } from './audio/matcher';
import type { FieldContext } from '../data/occurrence';
import type { Exemplar } from './audio/exemplars';
import { classifySongType, type SongTypeResult } from './audio/songType';
import { identifySong, describeSource, type SourceCandidate } from './audio/identify';
import { spectrogramThumbnail } from './audio/render';
import type { Spectrogram } from './audio/spectrogram';
import { extractImageFeatures } from './vision/imageFeatures';
import { matchPhoto, type PhotoMatchResult } from './vision/photoMatcher';
import type { LoadedImage } from './vision/loadImage';
import { getSpecies } from '../data/species';

export interface SongExcerpt {
  /** rotulo legivel: "trecho de 2.1-4.8 s", "faixa de 3.0-7.5 kHz" */
  label: string;
  features: AcousticFeatures;
  noteCount: number;
  startSec: number;
  endSec: number;
  kind: 'inteiro' | 'trecho' | 'faixa';
}

export interface SongAnalysis {
  kind: 'canto';
  features: AcousticFeatures;
  spectrogram: Spectrogram;
  thumbnail: string;
  identification: MatchResult;
  songType: SongTypeResult;
  /** recortes detectados na gravacao, para o usuario escolher qual analisar */
  excerpts: SongExcerpt[];
  /** indice do recorte escolhido automaticamente */
  chosenExcerpt: number;
  /** milissegundos gastos na analise, exibido para provar que roda no aparelho */
  elapsedMs: number;
}

/**
 * Pipeline completo do canto. Tudo roda no aparelho, sem rede: FFT ->
 * espectrograma -> features -> especie -> funcao da vocalizacao.
 *
 * A ordem importa: a especie e identificada primeiro porque o prior de
 * repertorio dela entra na classificacao funcional como desempate.
 */
/**
 * Reidentifica a partir das caracteristicas ja extraidas.
 *
 * Separado da analise porque as pistas de campo (ambiente, tamanho) mudam
 * durante a leitura do resultado, e refazer a FFT a cada toque de chip seria
 * desperdicio: o casamento custa menos de um milissegundo, a FFT custa dezenas.
 */
export function identifyFromFeatures(
  features: AcousticFeatures,
  context?: FieldContext,
  exemplars?: Exemplar[],
): { identification: MatchResult; songType: SongTypeResult } {
  const identification = matchSpecies(features, { context, exemplars });
  const best = identification.inconclusive ? undefined : identification.matches[0]?.species;
  return { identification, songType: classifySongType(features, best?.songTypePrior) };
}

function toExcerpt(candidate: SourceCandidate): SongExcerpt {
  return {
    label: describeSource(candidate.source),
    features: candidate.features,
    noteCount: candidate.features.noteCount,
    startSec: candidate.source.startSec,
    endSec: candidate.source.endSec,
    kind: candidate.source.kind,
  };
}

export function analyzeSong(samples: Float32Array, sampleRate: number, context?: FieldContext): SongAnalysis {
  const started = typeof performance !== 'undefined' ? performance.now() : Date.now();

  // A gravacao e quebrada em recortes e cada um e comparado isoladamente. Numa
  // gravacao com mais de uma ave, medir o arquivo inteiro produz uma media que
  // nenhuma delas cantou.
  const identified = identifySong(samples, sampleRate, { context });
  const features = identified.features;
  const spectrogram = identified.spectrogram;

  const { identification, songType } = identifyFromFeatures(features, context);
  const excerpts = identified.candidates.map(toExcerpt);
  const chosenExcerpt = Math.max(0, identified.candidates.indexOf(identified.chosen));

  const ended = typeof performance !== 'undefined' ? performance.now() : Date.now();

  return {
    kind: 'canto',
    features,
    spectrogram,
    excerpts,
    chosenExcerpt,
    thumbnail: spectrogramThumbnail(spectrogram),
    identification,
    songType,
    elapsedMs: Math.round(ended - started),
  };
}

export interface PhotoAnalysis {
  kind: 'foto';
  identification: PhotoMatchResult;
  thumbnail: string;
  /** observacao textual do modelo de visao, quando usado */
  assistNote?: string;
  elapsedMs: number;
}

export interface PhotoBoost {
  bySpecies?: Record<string, number>;
  byFamily?: Record<string, number>;
  source?: string;
}

export function analyzePhoto(image: LoadedImage, boost?: PhotoBoost, assistNote?: string): PhotoAnalysis {
  const started = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const features = extractImageFeatures(image.raw);
  const identification = matchPhoto(features, boost ? { boost } : {});
  const ended = typeof performance !== 'undefined' ? performance.now() : Date.now();

  return {
    kind: 'foto',
    identification,
    thumbnail: image.thumbnail,
    assistNote,
    elapsedMs: Math.round(ended - started),
  };
}

/** Resumo numerico guardado junto do registro, para a ficha da pokedex. */
export function metricsFrom(features: AcousticFeatures): Record<string, number> {
  return {
    frequenciaPicoHz: Math.round(features.peakHz),
    frequenciaMinHz: Math.round(features.lowHz),
    frequenciaMaxHz: Math.round(features.highHz),
    larguraBandaHz: Math.round(features.bandwidthHz),
    notas: features.noteCount,
    notasPorSegundo: Number(features.noteRate.toFixed(2)),
    duracaoNotaMs: Math.round(features.noteDurationMean * 1000),
    duracaoFraseS: Number(features.phraseDurationSec.toFixed(2)),
    pureza: Number(features.tonality.toFixed(3)),
    modulacao: Number(features.fmDepth.toFixed(3)),
    repeticao: Number(features.phraseRepetition.toFixed(3)),
    estereotipia: Number(features.stereotypy.toFixed(3)),
    repertorio: Number(features.noteDiversity.toFixed(3)),
    trinado: Number(features.trillIndex.toFixed(3)),
    relacaoSinalRuidoDb: Math.round(features.snrDb),
  };
}

export function speciesName(id: string): string {
  return getSpecies(id)?.commonName ?? id;
}
