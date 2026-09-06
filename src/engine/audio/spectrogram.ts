import { hannWindow, magnitudeSpectrum } from './fft';

export interface Spectrogram {
  /** magnitudes[frame][bin], ja limitado a banda util de aves */
  magnitudes: Float32Array[];
  /** frequencia central de cada bin mantido, em Hz */
  binFreqs: Float32Array;
  /** instante central de cada frame, em segundos */
  frameTimes: Float32Array;
  sampleRate: number;
  hopSeconds: number;
  frameSeconds: number;
}

export interface StftOptions {
  fftSize?: number;
  hopSize?: number;
  minHz?: number;
  maxHz?: number;
}

/**
 * Aves cantam grosso modo entre 250 Hz (pombas, jacus) e 12 kHz (alarmes agudos
 * de tiranideos). Cortar fora dessa banda remove transito, vento e vozes humanas
 * antes de qualquer medida.
 */
export const BIRD_MIN_HZ = 250;
export const BIRD_MAX_HZ = 12000;

export function computeSpectrogram(
  samples: Float32Array,
  sampleRate: number,
  options: StftOptions = {},
): Spectrogram {
  const fftSize = options.fftSize ?? 1024;
  const hopSize = options.hopSize ?? fftSize / 4;
  const minHz = options.minHz ?? BIRD_MIN_HZ;
  const maxHz = Math.min(options.maxHz ?? BIRD_MAX_HZ, sampleRate / 2);

  const window = hannWindow(fftSize);
  const scratch = { re: new Float32Array(fftSize), im: new Float32Array(fftSize) };
  const frame = new Float32Array(fftSize);

  const binHz = sampleRate / fftSize;
  // ceil no inicio e floor no fim: os bins mantidos ficam TODOS dentro de
  // [minHz, maxHz], senao o filtro deixa passar justamente a energia de
  // transito e voz humana que ele deveria cortar.
  const firstBin = Math.max(1, Math.ceil(minHz / binHz));
  const lastBin = Math.min(fftSize >> 1, Math.floor(maxHz / binHz));
  const keptBins = Math.max(1, lastBin - firstBin + 1);

  const binFreqs = new Float32Array(keptBins);
  for (let i = 0; i < keptBins; i++) binFreqs[i] = (firstBin + i) * binHz;

  const frameCount = samples.length >= fftSize ? 1 + Math.floor((samples.length - fftSize) / hopSize) : 0;
  const magnitudes: Float32Array[] = [];
  const frameTimes = new Float32Array(Math.max(0, frameCount));

  for (let f = 0; f < frameCount; f++) {
    const offset = f * hopSize;
    for (let i = 0; i < fftSize; i++) frame[i] = samples[offset + i] * window[i];
    const spectrum = magnitudeSpectrum(frame, scratch);
    const band = new Float32Array(keptBins);
    for (let i = 0; i < keptBins; i++) band[i] = spectrum[firstBin + i];
    magnitudes.push(band);
    frameTimes[f] = (offset + fftSize / 2) / sampleRate;
  }

  return {
    magnitudes,
    binFreqs,
    frameTimes,
    sampleRate,
    hopSeconds: hopSize / sampleRate,
    frameSeconds: fftSize / sampleRate,
  };
}

/**
 * Subtracao de ruido por mediana espectral: para cada bin, estima o piso de
 * ruido como a mediana ao longo do tempo e remove. E o pre-processamento
 * classico de bioacustica (Sprengel et al.) e e o que faz um canto distante
 * sobreviver ao ruido de fundo de uma cidade.
 */
export function denoise(spec: Spectrogram): Spectrogram {
  const frames = spec.magnitudes.length;
  if (frames === 0) return spec;
  const bins = spec.binFreqs.length;
  const column = new Float32Array(frames);
  const floor = new Float32Array(bins);

  for (let b = 0; b < bins; b++) {
    for (let f = 0; f < frames; f++) column[f] = spec.magnitudes[f][b];
    const sorted = Float32Array.from(column).sort();
    floor[b] = sorted[Math.floor(frames * 0.5)];
  }

  const cleaned = spec.magnitudes.map((row) => {
    const out = new Float32Array(bins);
    for (let b = 0; b < bins; b++) out[b] = Math.max(0, row[b] - floor[b] * 1.5);
    return out;
  });

  return { ...spec, magnitudes: cleaned };
}

/** Energia total por frame (envelope). */
export function energyEnvelope(spec: Spectrogram): Float32Array {
  const env = new Float32Array(spec.magnitudes.length);
  for (let f = 0; f < spec.magnitudes.length; f++) {
    let sum = 0;
    const row = spec.magnitudes[f];
    for (let b = 0; b < row.length; b++) sum += row[b] * row[b];
    env[f] = Math.sqrt(sum);
  }
  return env;
}

/** Converte o espectrograma em pixels (0-255) com escala log, pronto pra desenhar. */
export function toImageData(spec: Spectrogram, dynamicRangeDb = 60): Uint8ClampedArray {
  const frames = spec.magnitudes.length;
  const bins = spec.binFreqs.length;
  const out = new Uint8ClampedArray(frames * bins);
  let peak = 1e-9;
  for (const row of spec.magnitudes) for (const v of row) if (v > peak) peak = v;
  for (let f = 0; f < frames; f++) {
    const row = spec.magnitudes[f];
    for (let b = 0; b < bins; b++) {
      const db = 20 * Math.log10(Math.max(row[b], 1e-9) / peak);
      const norm = Math.max(0, 1 + db / dynamicRangeDb);
      out[f * bins + b] = Math.round(norm * 255);
    }
  }
  return out;
}
