import { nextPow2 } from './fft';

export interface RecordingResult {
  samples: Float32Array;
  sampleRate: number;
  durationSec: number;
}

export interface RecorderHandle {
  stop: () => Promise<RecordingResult>;
  cancel: () => void;
  /** copia o espectro instantaneo (0-1 por bin) para desenhar ao vivo */
  readSpectrum: (out: Float32Array) => number;
  /** nivel de entrada 0-1, para o medidor */
  readLevel: () => number;
  spectrumBins: number;
  sampleRate: number;
}

/**
 * Bioacustica exige o microfone CRU. Cancelamento de eco, supressao de ruido e
 * ganho automatico sao projetados para voz humana: eles achatam justamente as
 * notas curtas e agudas que distinguem uma especie da outra, e o AGC destroi a
 * medida de amplitude que a classificacao funcional usa.
 */
const RAW_AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
  channelCount: 1,
};

export async function startRecording(): Promise<RecorderHandle> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Este navegador nao permite acesso ao microfone.');
  }

  const stream = await navigator.mediaDevices.getUserMedia({ audio: RAW_AUDIO_CONSTRAINTS });
  const AudioCtx: typeof AudioContext =
    window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const context = new AudioCtx();
  if (context.state === 'suspended') await context.resume();

  const source = context.createMediaStreamSource(stream);

  const analyser = context.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.35;
  analyser.minDecibels = -95;
  analyser.maxDecibels = -10;
  source.connect(analyser);

  // ScriptProcessor esta marcado como legado, mas e o unico caminho de PCM cru
  // que funciona em todos os navegadores moveis relevantes hoje, inclusive
  // Safari do iOS. AudioWorklet exige um modulo separado servido a parte.
  const bufferSize = 4096;
  const processor = context.createScriptProcessor(bufferSize, 1, 1);
  const chunks: Float32Array[] = [];
  let total = 0;
  let peakLevel = 0;
  let stopped = false;

  processor.onaudioprocess = (event) => {
    if (stopped) return;
    const input = event.inputBuffer.getChannelData(0);
    const copy = new Float32Array(input.length);
    copy.set(input);
    chunks.push(copy);
    total += copy.length;
    let peak = 0;
    for (let i = 0; i < copy.length; i++) {
      const v = Math.abs(copy[i]);
      if (v > peak) peak = v;
    }
    peakLevel = peak;
  };

  source.connect(processor);
  // Destino mudo: o ScriptProcessor so dispara se estiver conectado a saida,
  // e o ganho zero impede realimentacao no alto-falante.
  const mute = context.createGain();
  mute.gain.value = 0;
  processor.connect(mute);
  mute.connect(context.destination);

  const freqData = new Uint8Array(analyser.frequencyBinCount);

  const teardown = () => {
    stopped = true;
    processor.onaudioprocess = null;
    try {
      processor.disconnect();
      analyser.disconnect();
      source.disconnect();
      mute.disconnect();
    } catch {
      // nos ja desconectados
    }
    for (const track of stream.getTracks()) track.stop();
    void context.close();
  };

  return {
    sampleRate: context.sampleRate,
    spectrumBins: analyser.frequencyBinCount,
    readSpectrum(out) {
      analyser.getByteFrequencyData(freqData);
      const n = Math.min(out.length, freqData.length);
      for (let i = 0; i < n; i++) out[i] = freqData[i] / 255;
      return n;
    },
    readLevel: () => peakLevel,
    cancel: teardown,
    async stop() {
      const sampleRate = context.sampleRate;
      teardown();
      const samples = new Float32Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        samples.set(chunk, offset);
        offset += chunk.length;
      }
      return { samples, sampleRate, durationSec: total / sampleRate };
    },
  };
}

/**
 * Escolhe a janela de analise a partir da taxa de amostragem: ~46 ms de janela
 * equilibra resolucao de frequencia (bins de ~22 Hz) com resolucao temporal
 * suficiente para separar notas de 30 ms de um trinado.
 */
export function analysisWindow(sampleRate: number): { fftSize: number; hopSize: number } {
  const fftSize = Math.min(4096, Math.max(512, nextPow2(sampleRate * 0.046)));
  return { fftSize, hopSize: fftSize / 4 };
}

/** Codifica PCM mono em WAV 16 bits, para guardar e reouvir o registro. */
export function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  const writeString = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

/** Decodifica um arquivo de audio enviado pelo usuario para PCM mono. */
export async function decodeAudioFile(file: Blob): Promise<RecordingResult> {
  const AudioCtx: typeof AudioContext =
    window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const context = new AudioCtx();
  try {
    const buffer = await context.decodeAudioData(await file.arrayBuffer());
    const channels = buffer.numberOfChannels;
    const out = new Float32Array(buffer.length);
    for (let c = 0; c < channels; c++) {
      const data = buffer.getChannelData(c);
      for (let i = 0; i < data.length; i++) out[i] += data[i] / channels;
    }
    return { samples: out, sampleRate: buffer.sampleRate, durationSec: buffer.duration };
  } finally {
    void context.close();
  }
}
