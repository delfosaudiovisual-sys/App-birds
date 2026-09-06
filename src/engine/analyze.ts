import { extractFeatures, type AcousticFeatures } from './audio/features';
import { matchSpecies, type MatchResult } from './audio/matcher';
import { classifySongType, type SongTypeResult } from './audio/songType';
import { analysisWindow } from './audio/recorder';
import { spectrogramThumbnail } from './audio/render';
import type { Spectrogram } from './audio/spectrogram';
import { extractImageFeatures } from './vision/imageFeatures';
import { matchPhoto, type PhotoMatchResult } from './vision/photoMatcher';
import type { LoadedImage } from './vision/loadImage';
import { getSpecies } from '../data/species';

export interface SongAnalysis {
  kind: 'canto';
  features: AcousticFeatures;
  spectrogram: Spectrogram;
  thumbnail: string;
  identification: MatchResult;
  songType: SongTypeResult;
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
export function analyzeSong(samples: Float32Array, sampleRate: number): SongAnalysis {
  const started = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const window = analysisWindow(sampleRate);
  const { features, spectrogram } = extractFeatures(samples, sampleRate, window);

  const identification = matchSpecies(features);
  const best = identification.inconclusive ? undefined : identification.matches[0]?.species;
  const songType = classifySongType(features, best?.songTypePrior);

  const ended = typeof performance !== 'undefined' ? performance.now() : Date.now();

  return {
    kind: 'canto',
    features,
    spectrogram,
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
