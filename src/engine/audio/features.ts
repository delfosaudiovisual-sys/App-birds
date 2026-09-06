import { computeSpectrogram, denoise, energyEnvelope, type Spectrogram } from './spectrogram';

export interface Note {
  startSec: number;
  endSec: number;
  durationSec: number;
  /** contorno de frequencia dominante, um valor por frame da nota */
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

/** Grupo de notas separado dos vizinhos por um silencio longo. */
export interface Phrase {
  startSec: number;
  endSec: number;
  durationSec: number;
  noteCount: number;
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
  /** 0-1, forca da repeticao de frase */
  phraseRepetition: number;
  /** duracao media da frase detectada, em segundos */
  phraseDurationSec: number;
  /** frases detectadas no trecho */
  phrases: Phrase[];

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

function median(values: ArrayLike<number>): number {
  return percentile(values, 0.5);
}

function stddev(values: ArrayLike<number>): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  let s = 0;
  for (let i = 0; i < values.length; i++) s += (values[i] - m) ** 2;
  return Math.sqrt(s / (values.length - 1));
}

/** Frequencia do pico com interpolacao parabolica entre bins vizinhos. */
function refinedPeak(row: Float32Array, binFreqs: Float32Array): { hz: number; mag: number } {
  let best = 0;
  for (let b = 1; b < row.length; b++) if (row[b] > row[best]) best = b;
  const mag = row[best];
  if (best <= 0 || best >= row.length - 1 || mag <= 0) {
    return { hz: binFreqs[best] ?? 0, mag };
  }
  const a = row[best - 1];
  const c = row[best + 1];
  const denom = a - 2 * mag + c;
  const shift = denom === 0 ? 0 : (0.5 * (a - c)) / denom;
  const step = binFreqs[1] - binFreqs[0];
  return { hz: binFreqs[best] + shift * step, mag };
}

/**
 * Quantis de energia acumulada: as frequencias que delimitam os 90% centrais da
 * energia do frame.
 *
 * Substitui a contagem de bins acima de um limiar, que inflava a banda porque
 * qualquer harmonico fraco entrava com o mesmo peso de um pico forte. Quantil
 * de energia e a medida usada em bioacustica justamente por isso.
 */
const BAND_MASK_DB = -30;

function energyBand(row: Float32Array, binFreqs: Float32Array): { low: number; high: number } {
  let peak = 0;
  for (let b = 0; b < row.length; b++) if (row[b] > peak) peak = row[b];
  if (peak <= 0) return { low: 0, high: 0 };

  // So bins a menos de 30 dB abaixo do pico do frame entram na conta. Sem essa
  // mascara o piso de ruido, espalhado por centenas de bins, empurra o quantil
  // de 95% ate o topo da banda e todo canto "ocupa" 12 kHz.
  const threshold = peak * 10 ** (BAND_MASK_DB / 20);

  let total = 0;
  for (let b = 0; b < row.length; b++) if (row[b] >= threshold) total += row[b] * row[b];
  if (total <= 0) return { low: 0, high: 0 };

  const lowTarget = total * 0.05;
  const highTarget = total * 0.95;
  let acc = 0;
  let low = binFreqs[0];
  let high = binFreqs[binFreqs.length - 1];
  let lowSet = false;
  for (let b = 0; b < row.length; b++) {
    if (row[b] < threshold) continue;
    acc += row[b] * row[b];
    if (!lowSet && acc >= lowTarget) {
      low = binFreqs[b];
      lowSet = true;
    }
    if (acc >= highTarget) {
      high = binFreqs[b];
      break;
    }
  }
  return { low, high: Math.max(high, low) };
}

/**
 * Concentracao espectral: fracao da energia do frame que cabe nos 4% de bins
 * mais fortes. Um assobio puro concentra quase tudo; ruido branco espalha.
 *
 * Substitui o achatamento espectral escalado a mao, que saturava em 0 para
 * qualquer som com serie harmonica — ou seja, para quase todo canto de ave.
 */
function spectralConcentration(row: Float32Array): number {
  const n = row.length;
  if (n === 0) return 0;
  let total = 0;
  for (let b = 0; b < n; b++) total += row[b] * row[b];
  if (total <= 0) return 0;

  const keep = Math.max(1, Math.round(n * 0.04));
  const powers = new Float64Array(n);
  for (let b = 0; b < n; b++) powers[b] = row[b] * row[b];
  powers.sort();
  let top = 0;
  for (let i = n - keep; i < n; i++) top += powers[i];
  return top / total;
}

/**
 * Mapeia concentracao espectral para 0-1.
 *
 * Os pontos de ancoragem foram MEDIDOS neste mesmo pipeline (ver calib.test.ts):
 * ruido de banda larga fica em ~0.17 e um assobio puro em ~0.85. A faixa e um
 * pouco mais larga que a medida para o valor nao saturar em 1 num canto real,
 * que fica entre os dois extremos.
 */
function concentrationToTonality(concentration: number): number {
  return clamp01((concentration - 0.15) / 0.75);
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

/** Fracao da energia que cai em multiplos inteiros da fundamental. */
function harmonicRatio(row: Float32Array, binFreqs: Float32Array, f0: number): number {
  if (f0 <= 0) return 0;
  const step = binFreqs[1] - binFreqs[0];
  const base = binFreqs[0];
  let harmonicEnergy = 0;
  let total = 0;
  for (let b = 0; b < row.length; b++) total += row[b];
  if (total <= 0) return 0;
  for (let k = 1; k <= 6; k++) {
    const idx = Math.round((f0 * k - base) / step);
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
 * Segmenta notas pelo envelope de energia com histerese (limiar alto para
 * abrir, baixo para fechar), evitando picotar uma nota longa que oscila.
 *
 * Os limites de fusao e de duracao minima sao curtos de proposito: um trinado
 * de corruira tem notas de 35 ms separadas por 15 ms de silencio, e uma fusao
 * generosa transformaria a frase inteira numa nota so — foi exatamente o que
 * acontecia antes.
 */
function segmentNotes(env: Float32Array, hopSeconds: number): Segment[] {
  if (env.length === 0) return [];
  const noiseFloor = percentile(env, 0.2);
  const peak = percentile(env, 0.98);
  if (peak <= noiseFloor * 1.15) return [];

  const openAt = noiseFloor + (peak - noiseFloor) * 0.3;
  const closeAt = noiseFloor + (peak - noiseFloor) * 0.15;

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

  const gapFrames = Math.max(1, Math.round(0.008 / hopSeconds));
  const minFrames = Math.max(1, Math.round(0.007 / hopSeconds));
  const merged: Segment[] = [];
  for (const seg of segments) {
    const last = merged[merged.length - 1];
    if (last && seg.start - last.end <= gapFrames) last.end = seg.end;
    else merged.push({ ...seg });
  }
  return merged.filter((s) => s.end - s.start >= minFrames);
}

/**
 * Agrupa notas em frases: um silencio muito maior que o intervalo tipico entre
 * notas marca o fim de uma frase.
 *
 * Medir a frase por agrupamento, e nao por autocorrelacao do envelope, foi o
 * que consertou a duracao de frase — a autocorrelacao travava no periodo
 * entre NOTAS, que e uma ordem de grandeza menor que o periodo entre FRASES.
 */
function groupPhrases(notes: Note[]): Phrase[] {
  if (notes.length === 0) return [];
  if (notes.length === 1) {
    const n = notes[0];
    return [{ startSec: n.startSec, endSec: n.endSec, durationSec: n.durationSec, noteCount: 1 }];
  }

  const gaps: number[] = [];
  for (let i = 1; i < notes.length; i++) gaps.push(notes[i].startSec - notes[i - 1].endSec);
  const typical = median(gaps);
  const boundary = Math.max(0.25, typical * 3);

  const phrases: Phrase[] = [];
  let startIdx = 0;
  for (let i = 1; i <= notes.length; i++) {
    const isLast = i === notes.length;
    const gap = isLast ? Infinity : notes[i].startSec - notes[i - 1].endSec;
    if (gap > boundary) {
      const first = notes[startIdx];
      const last = notes[i - 1];
      phrases.push({
        startSec: first.startSec,
        endSec: last.endSec,
        durationSec: last.endSec - first.startSec,
        noteCount: i - startIdx,
      });
      startIdx = i;
    }
  }
  return phrases;
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

export interface ExtractOptions {
  /** janela curta, para segmentacao e ritmo */
  timeFftSize?: number;
  timeHopSize?: number;
  /** janela longa, para altura e timbre */
  freqFftSize?: number;
  freqHopSize?: number;
}

/**
 * Extrai as caracteristicas acusticas em DUAS resolucoes.
 *
 * Uma janela so nao serve: para separar as notas de 35 ms de um trinado e
 * preciso resolucao temporal fina (janela curta), e para medir a altura de um
 * arrulho de 500 Hz e preciso resolucao de frequencia fina (janela longa).
 * Com uma janela intermediaria as duas medidas saem erradas ao mesmo tempo.
 */
export function extractFeatures(
  samples: Float32Array,
  sampleRate: number,
  options: ExtractOptions = {},
): { features: AcousticFeatures; spectrogram: Spectrogram } {
  const timeFft = options.timeFftSize ?? 512;
  const timeHop = options.timeHopSize ?? Math.max(32, timeFft / 4);
  const freqFft = options.freqFftSize ?? 2048;
  const freqHop = options.freqHopSize ?? Math.max(64, freqFft / 4);

  // A subtracao por mediana e boa para ACHAR notas (remove o fundo estacionario)
  // e ruim para MEDIR timbre: ela zera justamente a componente estavel de um
  // assobio sustentado. Por isso a segmentacao usa o espectro tratado e as
  // medidas espectrais usam o cru, protegidas pela mascara de banda.
  const timeSpec = denoise(computeSpectrogram(samples, sampleRate, { fftSize: timeFft, hopSize: timeHop }));
  const freqSpec = computeSpectrogram(samples, sampleRate, { fftSize: freqFft, hopSize: freqHop });
  const freqSpecDisplay = denoise(freqSpec);

  const env = energyEnvelope(timeSpec);
  const hop = timeSpec.hopSeconds;
  const totalDuration = samples.length / sampleRate;

  if (timeSpec.magnitudes.length === 0 || freqSpec.magnitudes.length === 0) {
    return { features: emptyFeatures(totalDuration), spectrogram: freqSpecDisplay };
  }

  const segments = segmentNotes(env, hop);

  const noiseFloor = percentile(env, 0.2) + 1e-9;
  const signalLevel = percentile(env, 0.95);
  const snrDb = 20 * Math.log10(Math.max(signalLevel, 1e-9) / noiseFloor);
  const envPeak = Math.max(...Array.from(env), 1e-9);

  // Indice do frame da janela LONGA que cobre um instante dado.
  const freqFrameAt = (sec: number) =>
    Math.max(0, Math.min(freqSpec.magnitudes.length - 1, Math.round(sec / freqSpec.hopSeconds)));

  const notes: Note[] = segments.map((seg) => {
    const startSec = seg.start * hop;
    const endSec = (seg.end + 1) * hop;
    const durationSec = endSec - startSec;

    const contour: number[] = [];
    const concentrations: number[] = [];
    const lows: number[] = [];
    const highs: number[] = [];

    const from = freqFrameAt(startSec);
    const to = freqFrameAt(endSec);
    for (let f = from; f <= to; f++) {
      const row = freqSpec.magnitudes[f];
      const { hz, mag } = refinedPeak(row, freqSpec.binFreqs);
      if (mag <= 0) continue;
      contour.push(hz);
      concentrations.push(spectralConcentration(row));
      const band = energyBand(row, freqSpec.binFreqs);
      lows.push(band.low);
      highs.push(band.high);
    }

    let amp = 0;
    for (let f = seg.start; f <= seg.end; f++) amp = Math.max(amp, env[f]);

    const low = lows.length ? percentile(lows, 0.2) : 0;
    const high = highs.length ? percentile(highs, 0.8) : 0;
    const sweep = contour.length > 1 ? (contour[contour.length - 1] - contour[0]) / durationSec : 0;

    return {
      startSec,
      endSec,
      durationSec,
      contour,
      peakHz: contour.length ? median(contour) : 0,
      lowHz: low,
      highHz: high,
      bandwidthHz: Math.max(0, high - low),
      tonality: concentrations.length ? concentrationToTonality(mean(concentrations)) : 0,
      amplitude: amp / envPeak,
      sweepHzPerSec: sweep,
    };
  });

  // ---- medidas espectrais globais, so nos frames com voz ----
  const voicedFreqFrames = new Set<number>();
  for (const note of notes) {
    for (let f = freqFrameAt(note.startSec); f <= freqFrameAt(note.endSec); f++) voicedFreqFrames.add(f);
  }

  const peakHzPerFrame: number[] = [];
  const concentrationPerFrame: number[] = [];
  const entropyPerFrame: number[] = [];
  const harmonicPerFrame: number[] = [];
  const centroidPerFrame: number[] = [];
  const lowPerFrame: number[] = [];
  const highPerFrame: number[] = [];

  for (const f of voicedFreqFrames) {
    const row = freqSpec.magnitudes[f];
    const { hz, mag } = refinedPeak(row, freqSpec.binFreqs);
    if (mag <= 0) continue;
    peakHzPerFrame.push(hz);
    concentrationPerFrame.push(spectralConcentration(row));
    entropyPerFrame.push(spectralEntropy(row));
    harmonicPerFrame.push(harmonicRatio(row, freqSpec.binFreqs, hz));

    const band = energyBand(row, freqSpec.binFreqs);
    lowPerFrame.push(band.low);
    highPerFrame.push(band.high);

    let num = 0;
    let den = 0;
    for (let b = 0; b < row.length; b++) {
      num += freqSpec.binFreqs[b] * row[b];
      den += row[b];
    }
    centroidPerFrame.push(den > 0 ? num / den : 0);
  }

  const voicedSec = notes.reduce((s, n) => s + n.durationSec, 0);
  const dutyCycle = totalDuration > 0 ? Math.min(1, voicedSec / totalDuration) : 0;

  const phrases = groupPhrases(notes);

  // A taxa de notas e medida DENTRO das frases: silencio entre frases nao pode
  // transformar um trinado rapido em canto lento.
  const phraseNoteSpan = phrases.reduce((s, p) => s + p.durationSec, 0);
  const phraseNotes = phrases.reduce((s, p) => s + p.noteCount, 0);
  const noteRate =
    phraseNoteSpan > 0.05 && phraseNotes > 1
      ? (phraseNotes - phrases.length) / phraseNoteSpan
      : notes.length
        ? 1 / Math.max(0.2, notes[0].durationSec)
        : 0;

  const intervals: number[] = [];
  for (let i = 1; i < notes.length; i++) {
    const gap = notes[i].startSec - notes[i - 1].startSec;
    // ignora o salto entre frases, que nao e ritmo e sim pausa
    if (gap < 0.6) intervals.push(gap);
  }
  const intervalMean = mean(intervals);
  const rhythmIrregularity = intervalMean > 0 ? Math.min(1, stddev(intervals) / intervalMean) : 0;

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

  // ---- estereotipia, repertorio e repeticao de frase ----
  let stereotypy = 0;
  let noteDiversity = 0;
  if (notes.length >= 2) {
    const sims: number[] = [];
    for (let i = 1; i < notes.length; i++) sims.push(contourSimilarity(notes[i - 1].contour, notes[i].contour));
    stereotypy = clamp01(mean(sims));

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

  // Repeticao de frase = quanto as frases consecutivas se parecem, comparando
  // o desenho de altura de cada uma. E o que caracteriza canto territorial.
  let phraseRepetition = 0;
  if (phrases.length >= 2) {
    const contours = phrases.map((p) =>
      notes.filter((n) => n.startSec >= p.startSec - 1e-6 && n.endSec <= p.endSec + 1e-6).flatMap((n) => n.contour),
    );
    const sims: number[] = [];
    for (let i = 1; i < contours.length; i++) {
      const durRatio =
        Math.min(phrases[i].durationSec, phrases[i - 1].durationSec) /
        Math.max(phrases[i].durationSec, phrases[i - 1].durationSec, 1e-6);
      sims.push(contourSimilarity(contours[i - 1], contours[i]) * durRatio);
    }
    phraseRepetition = clamp01(mean(sims));
  }

  const phraseDurationSec = phrases.length
    ? mean(phrases.map((p) => p.durationSec))
    : notes.length
      ? notes[notes.length - 1].endSec - notes[0].startSec
      : 0;

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

  const tonality = concentrationPerFrame.length ? concentrationToTonality(mean(concentrationPerFrame)) : 0;
  const signalQuality = clamp01(
    0.5 * clamp01((snrDb - 4) / 20) + 0.3 * clamp01(notes.length / 3) + 0.2 * clamp01(dutyCycle * 4),
  );

  const features: AcousticFeatures = {
    durationSec: totalDuration,
    dutyCycle,
    peakHz: peakHzPerFrame.length ? median(peakHzPerFrame) : 0,
    lowHz: lowPerFrame.length ? percentile(lowPerFrame, 0.15) : 0,
    highHz: highPerFrame.length ? percentile(highPerFrame, 0.85) : 0,
    bandwidthHz: lowPerFrame.length
      ? Math.max(0, percentile(highPerFrame, 0.85) - percentile(lowPerFrame, 0.15))
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
    phraseRepetition,
    phraseDurationSec,
    phrases,
    onsetSharpness,
    amplitudeTrend,
    snrDb,
    signalQuality,
    melodyContour,
  };

  return { features, spectrogram: freqSpecDisplay };
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
    phrases: [],
    onsetSharpness: 0,
    amplitudeTrend: 0,
    snrDb: 0,
    signalQuality: 0,
    melodyContour: new Array(32).fill(0.5),
  };
}
