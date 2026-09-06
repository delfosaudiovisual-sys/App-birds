import { computeSpectrogram, denoise, energyEnvelope, type Spectrogram } from './spectrogram';

export interface Note {
  startSec: number;
  endSec: number;
  durationSec: number;
  /** contorno de frequencia dominante, um valor por frame do frame da nota */
  contour: number[];
  peakHz: number;
  lowHz: number;
  highHz: number;
  bandwidthHz: number;
  /** 0 = ruidoso/aspero, 1 = assobio puro */
  tonality: number;
  /** amplitude relativa (0-1) */
  amplitude: number;
  /** subida (>0) ou descida (<0) media de frequencia, em Hz/s */
  sweepHzPerSec: number;
}

export interface AcousticFeatures {
  durationSec: number;
  /** proporcao do trecho em que ha vocalizacao */
  dutyCycle: number;

  peakHz: number;
  lowHz: number;
  highHz: number;
  bandwidthHz: number;
  centroidHz: number;

  /** 0 = banda larga/aspero (chiado), 1 = tom puro (assobio) */
  tonality: number;
  /** 0-1, quanto a energia se organiza em serie harmonica */
  harmonicity: number;
  /** entropia espectral normalizada, 0-1: 1 = ruido branco */
  entropy: number;

  notes: Note[];
  noteCount: number;
  /** notas por segundo dentro das frases */
  noteRate: number;
  noteDurationMean: number;
  /** coeficiente de variacao dos intervalos entre notas: 0 = metronomo */
  rhythmIrregularity: number;
  /** 0-1, quao trinado (rapido + regular) */
  trillIndex: number;

  /** 0-1, profundidade de modulacao de frequencia dentro das notas */
  fmDepth: number;
  /** modulacoes por segundo */
  fmRateHz: number;

  /** 0-1, quao identicas sao as repeticoes (canto estereotipado) */
  stereotypy: number;
  /** 0-1, quantos tipos distintos de nota (repertorio dentro do trecho) */
  noteDiversity: number;
  /** 0-1, forca da periodicidade de frase no envelope */
  phraseRepetition: number;
  /** duracao media da frase detectada, em segundos */
  phraseDurationSec: number;

  /** 0-1, quao abrupto e o ataque das notas */
  onsetSharpness: number;
  /** tendencia de amplitude ao longo do trecho: >0 crescendo */
  amplitudeTrend: number;

  /** dB estimados entre vocalizacao e piso de ruido */
  snrDb: number;
  /** 0-1, confianca de que ha mesmo uma ave no trecho */
  signalQuality: number;

  /** contorno global de pitch reamostrado em 32 pontos, normalizado 0-1 */
  melodyContour: number[];
}

function percentile(values: ArrayLike<number>, p: number): number {
  if (values.length === 0) return 0;
  const arr = Array.from(values).sort((a, b) => a - b);
  const idx = Math.min(arr.length - 1, Math.max(0, Math.round((arr.length - 1) * p)));
  return arr[idx];
}

function mean(values: ArrayLike<number>): number {
  if (values.length === 0) return 0;
  let s = 0;
  for (let i = 0; i < values.length; i++) s += values[i];
  return s / values.length;
}

function stddev(values: ArrayLike<number>): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  let s = 0;
  for (let i = 0; i < values.length; i++) s += (values[i] - m) ** 2;
  return Math.sqrt(s / (values.length - 1));
}

/** Frequencia do pico com interpolacao parabolica entre bins vizinhos. */
function refinedPeak(row: Float32Array, binFreqs: Float32Array): { hz: number; mag: number; index: number } {
  let best = 0;
  for (let b = 1; b < row.length; b++) if (row[b] > row[best]) best = b;
  const mag = row[best];
  if (best <= 0 || best >= row.length - 1 || mag <= 0) {
    return { hz: binFreqs[best] ?? 0, mag, index: best };
  }
  const a = row[best - 1];
  const c = row[best + 1];
  const denom = a - 2 * mag + c;
  const shift = denom === 0 ? 0 : (0.5 * (a - c)) / denom;
  const step = binFreqs[1] - binFreqs[0];
  return { hz: binFreqs[best] + shift * step, mag, index: best };
}

/** Achatamento espectral (media geometrica / media aritmetica). 1 = ruido. */
function spectralFlatness(row: Float32Array): number {
  let logSum = 0;
  let sum = 0;
  let n = 0;
  for (let b = 0; b < row.length; b++) {
    const v = row[b] + 1e-9;
    logSum += Math.log(v);
    sum += v;
    n++;
  }
  if (n === 0 || sum === 0) return 1;
  return Math.exp(logSum / n) / (sum / n);
}

function spectralEntropy(row: Float32Array): number {
  let sum = 0;
  for (let b = 0; b < row.length; b++) sum += row[b];
  if (sum <= 0) return 1;
  let h = 0;
  for (let b = 0; b < row.length; b++) {
    const p = row[b] / sum;
    if (p > 0) h -= p * Math.log(p);
  }
  return h / Math.log(row.length);
}

/**
 * Mede quanto da energia cai em multiplos inteiros da fundamental.
 * Sabias e canarios tem pilha harmonica limpa; chiados de bem-te-vi nao.
 */
function harmonicRatio(row: Float32Array, binFreqs: Float32Array, f0: number): number {
  if (f0 <= 0) return 0;
  const step = binFreqs[1] - binFreqs[0];
  const base = binFreqs[0];
  let harmonicEnergy = 0;
  let total = 0;
  for (let b = 0; b < row.length; b++) total += row[b];
  if (total <= 0) return 0;
  for (let k = 1; k <= 6; k++) {
    const target = f0 * k;
    const idx = Math.round((target - base) / step);
    if (idx < 0 || idx >= row.length) continue;
    for (let d = -1; d <= 1; d++) {
      const i = idx + d;
      if (i >= 0 && i < row.length) harmonicEnergy += row[i];
    }
  }
  return Math.min(1, harmonicEnergy / total);
}

interface Segment {
  start: number;
  end: number;
}

/**
 * Segmenta notas pelo envelope de energia com histerese (limiar alto pra abrir,
 * baixo pra fechar). Histerese evita picotar uma nota longa que oscila em volta
 * de um limiar unico.
 */
function segmentNotes(env: Float32Array, hopSeconds: number): Segment[] {
  if (env.length === 0) return [];
  const noiseFloor = percentile(env, 0.2);
  const peak = percentile(env, 0.98);
  if (peak <= noiseFloor * 1.2) return [];

  const openAt = noiseFloor + (peak - noiseFloor) * 0.28;
  const closeAt = noiseFloor + (peak - noiseFloor) * 0.14;

  const segments: Segment[] = [];
  let start = -1;
  for (let i = 0; i < env.length; i++) {
    if (start < 0 && env[i] >= openAt) start = i;
    else if (start >= 0 && env[i] < closeAt) {
      segments.push({ start, end: i });
      start = -1;
    }
  }
  if (start >= 0) segments.push({ start, end: env.length - 1 });

  // Funde notas separadas por menos de 25 ms (sao a mesma silaba) e
  // descarta cliques com menos de 12 ms.
  const gapFrames = Math.max(1, Math.round(0.025 / hopSeconds));
  const minFrames = Math.max(1, Math.round(0.012 / hopSeconds));
  const merged: Segment[] = [];
  for (const seg of segments) {
    const last = merged[merged.length - 1];
    if (last && seg.start - last.end <= gapFrames) last.end = seg.end;
    else merged.push({ ...seg });
  }
  return merged.filter((s) => s.end - s.start >= minFrames);
}

/** Correlacao de Pearson entre dois contornos reamostrados. */
function contourSimilarity(a: number[], b: number[]): number {
  const n = 16;
  const ra = resample(a, n);
  const rb = resample(b, n);
  const ma = mean(ra);
  const mb = mean(rb);
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    const x = ra[i] - ma;
    const y = rb[i] - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  if (da === 0 || db === 0) return da === db ? 1 : 0;
  return Math.max(0, num / Math.sqrt(da * db));
}

export function resample(values: number[], n: number): number[] {
  if (values.length === 0) return new Array(n).fill(0);
  if (values.length === 1) return new Array(n).fill(values[0]);
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const pos = (i / (n - 1)) * (values.length - 1);
    const lo = Math.floor(pos);
    const hi = Math.min(values.length - 1, lo + 1);
    const t = pos - lo;
    out[i] = values[lo] * (1 - t) + values[hi] * t;
  }
  return out;
}

/** Autocorrelacao normalizada do envelope: acha periodicidade de frase. */
function envelopePeriodicity(env: Float32Array, hopSeconds: number): { strength: number; periodSec: number } {
  const n = env.length;
  if (n < 16) return { strength: 0, periodSec: 0 };
  const m = mean(env);
  const centered = new Float32Array(n);
  for (let i = 0; i < n; i++) centered[i] = env[i] - m;

  let zeroLag = 0;
  for (let i = 0; i < n; i++) zeroLag += centered[i] * centered[i];
  if (zeroLag <= 0) return { strength: 0, periodSec: 0 };

  const minLag = Math.max(2, Math.round(0.12 / hopSeconds));
  const maxLag = Math.min(n - 2, Math.round(4.0 / hopSeconds));
  let bestLag = 0;
  let bestVal = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let acc = 0;
    for (let i = 0; i + lag < n; i++) acc += centered[i] * centered[i + lag];
    const norm = acc / zeroLag;
    if (norm > bestVal) {
      bestVal = norm;
      bestLag = lag;
    }
  }
  return { strength: Math.max(0, Math.min(1, bestVal)), periodSec: bestLag * hopSeconds };
}

export interface ExtractOptions {
  fftSize?: number;
  hopSize?: number;
}

export function extractFeatures(
  samples: Float32Array,
  sampleRate: number,
  options: ExtractOptions = {},
): { features: AcousticFeatures; spectrogram: Spectrogram } {
  const raw = computeSpectrogram(samples, sampleRate, {
    fftSize: options.fftSize ?? 1024,
    hopSize: options.hopSize ?? 256,
  });
  const spec = denoise(raw);
  const env = energyEnvelope(spec);
  const hop = spec.hopSeconds;
  const totalDuration = samples.length / sampleRate;

  const frames = spec.magnitudes.length;
  if (frames === 0) {
    return { features: emptyFeatures(totalDuration), spectrogram: spec };
  }

  const segments = segmentNotes(env, hop);
  const voicedFrames = new Set<number>();
  for (const seg of segments) for (let i = seg.start; i <= seg.end; i++) voicedFrames.add(i);

  // ---- medidas espectrais somente nos frames com voz ----
  const peakHzPerFrame: number[] = [];
  const flatnessPerFrame: number[] = [];
  const entropyPerFrame: number[] = [];
  const harmonicPerFrame: number[] = [];
  const centroidPerFrame: number[] = [];
  const energyWeightedFreqs: number[] = [];

  for (const f of voicedFrames) {
    const row = spec.magnitudes[f];
    const { hz, mag } = refinedPeak(row, spec.binFreqs);
    if (mag <= 0) continue;
    peakHzPerFrame.push(hz);
    flatnessPerFrame.push(spectralFlatness(row));
    entropyPerFrame.push(spectralEntropy(row));
    harmonicPerFrame.push(harmonicRatio(row, spec.binFreqs, hz));

    let num = 0;
    let den = 0;
    let rowPeak = 0;
    for (let b = 0; b < row.length; b++) if (row[b] > rowPeak) rowPeak = row[b];
    for (let b = 0; b < row.length; b++) {
      num += spec.binFreqs[b] * row[b];
      den += row[b];
      // bins acima de -20 dB do pico do frame definem a banda ocupada
      if (row[b] > rowPeak * 0.1) energyWeightedFreqs.push(spec.binFreqs[b]);
    }
    centroidPerFrame.push(den > 0 ? num / den : 0);
  }

  const noiseFloor = percentile(env, 0.2) + 1e-9;
  const signalLevel = percentile(env, 0.95);
  const snrDb = 20 * Math.log10(Math.max(signalLevel, 1e-9) / noiseFloor);

  // ---- notas ----
  const envPeak = Math.max(...Array.from(env), 1e-9);
  const notes: Note[] = segments.map((seg) => {
    const contour: number[] = [];
    const flatness: number[] = [];
    let amp = 0;
    const freqs: number[] = [];
    for (let f = seg.start; f <= seg.end; f++) {
      const row = spec.magnitudes[f];
      const { hz, mag } = refinedPeak(row, spec.binFreqs);
      if (mag > 0) {
        contour.push(hz);
        flatness.push(spectralFlatness(row));
        let rowPeak = 0;
        for (let b = 0; b < row.length; b++) if (row[b] > rowPeak) rowPeak = row[b];
        for (let b = 0; b < row.length; b++) if (row[b] > rowPeak * 0.1) freqs.push(spec.binFreqs[b]);
      }
      amp = Math.max(amp, env[f]);
    }
    const durationSec = (seg.end - seg.start + 1) * hop;
    const low = freqs.length ? percentile(freqs, 0.05) : 0;
    const high = freqs.length ? percentile(freqs, 0.95) : 0;
    const sweep = contour.length > 1 ? (contour[contour.length - 1] - contour[0]) / durationSec : 0;
    return {
      startSec: seg.start * hop,
      endSec: (seg.end + 1) * hop,
      durationSec,
      contour,
      peakHz: contour.length ? percentile(contour, 0.5) : 0,
      lowHz: low,
      highHz: high,
      bandwidthHz: Math.max(0, high - low),
      tonality: flatness.length ? 1 - Math.min(1, mean(flatness) * 3) : 0,
      amplitude: amp / envPeak,
      sweepHzPerSec: sweep,
    };
  });

  const voicedSec = notes.reduce((s, n) => s + n.durationSec, 0);
  const dutyCycle = totalDuration > 0 ? Math.min(1, voicedSec / totalDuration) : 0;

  // Taxa de notas medida dentro da janela cantada (do inicio da 1a ao fim da
  // ultima), nao sobre a gravacao inteira: 3 s de silencio no fim nao devem
  // transformar um trinado em canto lento.
  const spanSec =
    notes.length > 1 ? notes[notes.length - 1].endSec - notes[0].startSec : notes[0]?.durationSec ?? 0;
  const noteRate = spanSec > 0 && notes.length > 1 ? (notes.length - 1) / spanSec : notes.length ? 1 / Math.max(0.2, notes[0].durationSec) : 0;

  const intervals: number[] = [];
  for (let i = 1; i < notes.length; i++) intervals.push(notes[i].startSec - notes[i - 1].startSec);
  const intervalMean = mean(intervals);
  const rhythmIrregularity = intervalMean > 0 ? Math.min(1, stddev(intervals) / intervalMean) : 0;

  // Trinado = rapido E regular. Um bando barulhento e rapido, mas irregular.
  const rateScore = clamp01((noteRate - 6) / 10);
  const trillIndex = notes.length >= 4 ? rateScore * (1 - Math.min(1, rhythmIrregularity * 1.6)) : 0;

  // ---- modulacao de frequencia dentro das notas ----
  let fmDepthAcc = 0;
  let fmRateAcc = 0;
  let fmCount = 0;
  for (const note of notes) {
    if (note.contour.length < 3) continue;
    const lo = percentile(note.contour, 0.05);
    const hi = percentile(note.contour, 0.95);
    const center = (hi + lo) / 2;
    if (center > 0) fmDepthAcc += clamp01((hi - lo) / center);
    let turns = 0;
    for (let i = 2; i < note.contour.length; i++) {
      const d1 = note.contour[i - 1] - note.contour[i - 2];
      const d2 = note.contour[i] - note.contour[i - 1];
      if (d1 * d2 < 0 && Math.abs(d1) > 30 && Math.abs(d2) > 30) turns++;
    }
    fmRateAcc += note.durationSec > 0 ? turns / note.durationSec : 0;
    fmCount++;
  }
  const fmDepth = fmCount ? fmDepthAcc / fmCount : 0;
  const fmRateHz = fmCount ? fmRateAcc / fmCount : 0;

  // ---- estereotipia e diversidade de notas ----
  let stereotypy = 0;
  let noteDiversity = 0;
  if (notes.length >= 2) {
    const sims: number[] = [];
    for (let i = 1; i < notes.length; i++) sims.push(contourSimilarity(notes[i - 1].contour, notes[i].contour));
    stereotypy = clamp01(mean(sims));

    // Agrupa notas por similaridade de contorno + frequencia; o numero de
    // grupos aproxima o tamanho do repertorio usado no trecho.
    const clusters: number[][] = [];
    notes.forEach((note, idx) => {
      const found = clusters.find((c) => {
        const ref = notes[c[0]];
        const freqClose = Math.abs(Math.log2((note.peakHz + 1) / (ref.peakHz + 1))) < 0.35;
        return freqClose && contourSimilarity(ref.contour, note.contour) > 0.6;
      });
      if (found) found.push(idx);
      else clusters.push([idx]);
    });
    noteDiversity = clamp01((clusters.length - 1) / Math.max(1, Math.min(notes.length, 12) - 1));
  }

  const periodicity = envelopePeriodicity(env, hop);

  // ---- ataque e tendencia de amplitude ----
  let onsetAcc = 0;
  for (const note of notes) {
    const frames10 = Math.max(1, Math.round(0.01 / hop));
    const idx = Math.round(note.startSec / hop);
    const a = env[Math.min(env.length - 1, idx)] ?? 0;
    const b = env[Math.min(env.length - 1, idx + frames10)] ?? a;
    onsetAcc += clamp01(Math.abs(b - a) / (envPeak * 0.5));
  }
  const onsetSharpness = notes.length ? onsetAcc / notes.length : 0;

  let amplitudeTrend = 0;
  if (notes.length >= 3) {
    const half = Math.floor(notes.length / 2);
    const first = mean(notes.slice(0, half).map((n) => n.amplitude));
    const last = mean(notes.slice(notes.length - half).map((n) => n.amplitude));
    amplitudeTrend = Math.max(-1, Math.min(1, (last - first) / Math.max(0.05, first)));
  }

  const globalContour = notes.flatMap((n) => n.contour);
  const contourLow = globalContour.length ? percentile(globalContour, 0.02) : 0;
  const contourHigh = globalContour.length ? percentile(globalContour, 0.98) : 1;
  const melodyContour = resample(globalContour, 32).map((hz) =>
    contourHigh > contourLow ? clamp01((hz - contourLow) / (contourHigh - contourLow)) : 0.5,
  );

  const tonality = flatnessPerFrame.length ? clamp01(1 - mean(flatnessPerFrame) * 3) : 0;
  const signalQuality = clamp01(
    0.5 * clamp01((snrDb - 4) / 20) + 0.3 * clamp01(notes.length / 3) + 0.2 * clamp01(dutyCycle * 4),
  );

  const features: AcousticFeatures = {
    durationSec: totalDuration,
    dutyCycle,
    peakHz: peakHzPerFrame.length ? percentile(peakHzPerFrame, 0.5) : 0,
    lowHz: energyWeightedFreqs.length ? percentile(energyWeightedFreqs, 0.05) : 0,
    highHz: energyWeightedFreqs.length ? percentile(energyWeightedFreqs, 0.95) : 0,
    bandwidthHz: energyWeightedFreqs.length
      ? Math.max(0, percentile(energyWeightedFreqs, 0.95) - percentile(energyWeightedFreqs, 0.05))
      : 0,
    centroidHz: centroidPerFrame.length ? mean(centroidPerFrame) : 0,
    tonality,
    harmonicity: harmonicPerFrame.length ? clamp01(mean(harmonicPerFrame)) : 0,
    entropy: entropyPerFrame.length ? clamp01(mean(entropyPerFrame)) : 1,
    notes,
    noteCount: notes.length,
    noteRate,
    noteDurationMean: notes.length ? mean(notes.map((n) => n.durationSec)) : 0,
    rhythmIrregularity,
    trillIndex,
    fmDepth,
    fmRateHz,
    stereotypy,
    noteDiversity,
    phraseRepetition: periodicity.strength,
    phraseDurationSec: periodicity.periodSec || spanSec,
    onsetSharpness,
    amplitudeTrend,
    snrDb,
    signalQuality,
    melodyContour,
  };

  return { features, spectrogram: spec };
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function emptyFeatures(durationSec: number): AcousticFeatures {
  return {
    durationSec,
    dutyCycle: 0,
    peakHz: 0,
    lowHz: 0,
    highHz: 0,
    bandwidthHz: 0,
    centroidHz: 0,
    tonality: 0,
    harmonicity: 0,
    entropy: 1,
    notes: [],
    noteCount: 0,
    noteRate: 0,
    noteDurationMean: 0,
    rhythmIrregularity: 0,
    trillIndex: 0,
    fmDepth: 0,
    fmRateHz: 0,
    stereotypy: 0,
    noteDiversity: 0,
    phraseRepetition: 0,
    phraseDurationSec: 0,
    onsetSharpness: 0,
    amplitudeTrend: 0,
    snrDb: 0,
    signalQuality: 0,
    melodyContour: new Array(32).fill(0.5),
  };
}
