import type { FieldContext } from '../../data/occurrence';
import { extractFeatures, type AcousticFeatures } from './features';
import { matchSpecies, type MatchResult } from './matcher';
import { analysisWindow } from './recorder';
import { findSources, type SoundSource } from './sources';
import type { Spectrogram } from './spectrogram';

/**
 * Identificacao por canto sobre uma gravacao de campo.
 *
 * A diferenca em relacao a simplesmente medir o arquivo inteiro: a gravacao e
 * quebrada em fontes candidatas (rajadas no tempo, faixas de frequencia) e cada
 * uma e comparada com a base isoladamente. Vence a que casar melhor.
 *
 * O motivo esta medido em scene.bench.ts: com uma unica ave ao fundo, a analise
 * global cai para 4% de acerto porque mistura os dois cantos numa media que
 * nenhuma das aves produziu. Comparar recorte por recorte devolve a cada canto
 * a chance de ser reconhecido pelo que ele e.
 */

export interface SourceCandidate {
  source: SoundSource;
  features: AcousticFeatures;
  result: MatchResult;
  /** aderencia do melhor casamento deste recorte */
  fit: number;
}

export interface SongIdentification {
  /** melhor casamento entre todas as fontes */
  result: MatchResult;
  /** caracteristicas da fonte escolhida — e o que a tela deve exibir */
  features: AcousticFeatures;
  /** espectrograma da gravacao inteira, para desenhar */
  spectrogram: Spectrogram;
  /** recorte escolhido */
  chosen: SourceCandidate;
  /** todos os recortes avaliados, do melhor para o pior */
  candidates: SourceCandidate[];
}

/**
 * Um recorte precisa de evidencia minima para competir. Sem isso, um pedaco com
 * duas notas soltas pode ganhar por acaso de um recorte longo e bem descrito —
 * quanto menos evidencia, mais facil e casar bem com QUALQUER coisa.
 */
function isViable(features: AcousticFeatures): boolean {
  return features.noteCount >= 2 && features.signalQuality > 0.15;
}

/**
 * Criterio de escolha automatica do recorte.
 *
 * Foi escolhido por medicao, nao por intuicao. Em selection.bench.ts, oito
 * criterios foram comparados; `confidence` venceu (9,1% contra 8,2% de analisar
 * o arquivo inteiro). Aderencia pura mediu PIOR que nao separar nada — porque
 * um fragmento de duas notas casa bem com quase qualquer especie, e a aderencia
 * sozinha nao sabe que aquilo e pouca evidencia. `confidence` ja combina
 * aderencia, distancia para o segundo colocado e qualidade do sinal.
 *
 * Vale o registro honesto: o mesmo banco mostra que escolher sempre o recorte
 * certo daria 16,6%. Nenhum criterio automatico chegou perto disso, e e por
 * isso que a tela oferece os recortes para o usuario escolher — quem ouviu a
 * ave sabe qual trecho e dela.
 */
function selectionScore(candidate: SourceCandidate): number {
  return candidate.result.confidence;
}

export interface IdentifyOptions {
  context?: FieldContext;
  topN?: number;
  maxSources?: number;
}

export function identifySong(
  samples: Float32Array,
  sampleRate: number,
  options: IdentifyOptions = {},
): SongIdentification {
  const window = analysisWindow(sampleRate);
  const whole = extractFeatures(samples, sampleRate, window);

  const sources = findSources(samples, sampleRate, whole.features.notes, {
    maxSources: options.maxSources ?? 5,
  });

  const candidates: SourceCandidate[] = [];
  for (const source of sources) {
    // O recorte "inteiro" ja foi analisado acima; reaproveita em vez de refazer
    // a FFT, que e a parte cara.
    const features =
      source.kind === 'inteiro'
        ? whole.features
        : extractFeatures(source.samples, sampleRate, window).features;

    const result = matchSpecies(features, { topN: options.topN ?? 5, context: options.context });
    candidates.push({ source, features, result, fit: result.matches[0]?.fit ?? 0 });
  }

  const viable = candidates.filter((c) => isViable(c.features));
  const pool = viable.length > 0 ? viable : candidates;

  // Em empate tecnico, mais notas ganha: descreve o canto com mais evidencia.
  pool.sort((a, b) => {
    const diff = selectionScore(b) - selectionScore(a);
    return Math.abs(diff) > 0.02 ? diff : b.features.noteCount - a.features.noteCount;
  });

  const chosen = pool[0] ?? candidates[0];

  return {
    result: chosen.result,
    features: chosen.features,
    spectrogram: whole.spectrogram,
    chosen,
    candidates: [...pool, ...candidates.filter((c) => !pool.includes(c))],
  };
}

/** Descricao curta do recorte escolhido, para a tela explicar o que analisou. */
export function describeSource(source: SoundSource): string {
  const span = `${source.startSec.toFixed(1)}–${source.endSec.toFixed(1)} s`;
  if (source.kind === 'inteiro') return 'gravacao inteira';
  if (source.kind === 'trecho') return `trecho de ${span}`;
  return `faixa de ${(source.lowHz / 1000).toFixed(1)}–${(source.highHz / 1000).toFixed(1)} kHz em ${span}`;
}
