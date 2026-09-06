import { describe, expect, it } from 'vitest';
import { fftInPlace, magnitudeSpectrum, hannWindow } from './fft';
import { computeSpectrogram } from './spectrogram';
import { extractFeatures } from './features';
import { classifySongType } from './songType';
import { dtwSimilarity, matchSpecies } from './matcher';

const SR = 22050;

/** DFT ingenua, so pra conferir a FFT. */
function naiveDft(x: Float32Array) {
  const n = x.length;
  const out: { re: number; im: number }[] = [];
  for (let k = 0; k < n; k++) {
    let re = 0;
    let im = 0;
    for (let t = 0; t < n; t++) {
      const ang = (-2 * Math.PI * k * t) / n;
      re += x[t] * Math.cos(ang);
      im += x[t] * Math.sin(ang);
    }
    out.push({ re, im });
  }
  return out;
}

interface ToneSpec {
  startSec: number;
  durationSec: number;
  freqStartHz: number;
  freqEndHz?: number;
  amplitude?: number;
  /** 0 = tom puro, 1 = so ruido */
  noisiness?: number;
}

/** Sintetiza uma vocalizacao a partir de uma lista de notas. */
function synth(totalSec: number, tones: ToneSpec[], noiseFloor = 0.001): Float32Array {
  const out = new Float32Array(Math.round(totalSec * SR));
  // ruido de fundo determinista
  let seed = 12345;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff - 0.5;
  };
  for (let i = 0; i < out.length; i++) out[i] = rnd() * noiseFloor;

  for (const tone of tones) {
    const start = Math.round(tone.startSec * SR);
    const len = Math.round(tone.durationSec * SR);
    const amp = tone.amplitude ?? 0.5;
    const noisiness = tone.noisiness ?? 0;
    let phase = 0;
    for (let i = 0; i < len; i++) {
      const idx = start + i;
      if (idx >= out.length) break;
      const t = i / len;
      const f = tone.freqStartHz + ((tone.freqEndHz ?? tone.freqStartHz) - tone.freqStartHz) * t;
      phase += (2 * Math.PI * f) / SR;
      // envelope com ataque e queda suaves pra nao criar clique
      const env = Math.sin(Math.PI * t) ** 0.5;
      const tonal = Math.sin(phase);
      const noise = rnd() * 2;
      out[idx] += amp * env * (tonal * (1 - noisiness) + noise * noisiness);
    }
  }
  return out;
}

describe('FFT', () => {
  it('bate com a DFT ingenua', () => {
    const n = 64;
    const x = new Float32Array(n);
    for (let i = 0; i < n; i++) x[i] = Math.sin((2 * Math.PI * 5 * i) / n) + 0.3 * Math.cos((2 * Math.PI * 11 * i) / n);
    const expected = naiveDft(x);

    const re = Float32Array.from(x);
    const im = new Float32Array(n);
    fftInPlace(re, im);

    for (let k = 0; k < n; k++) {
      expect(re[k]).toBeCloseTo(expected[k].re, 2);
      expect(im[k]).toBeCloseTo(expected[k].im, 2);
    }
  });

  it('recusa tamanho que nao e potencia de 2', () => {
    expect(() => fftInPlace(new Float32Array(6), new Float32Array(6))).toThrow(/potencia de 2/);
  });

  it('localiza o bin correto de uma senoide', () => {
    const n = 1024;
    const freq = 2000;
    const x = new Float32Array(n);
    const w = hannWindow(n);
    for (let i = 0; i < n; i++) x[i] = Math.sin((2 * Math.PI * freq * i) / SR) * w[i];
    const mag = magnitudeSpectrum(x);
    let peak = 0;
    for (let i = 1; i < mag.length; i++) if (mag[i] > mag[peak]) peak = i;
    expect((peak * SR) / n).toBeCloseTo(freq, -2);
  });
});

describe('espectrograma', () => {
  it('limita a banda util de aves e mantem o eixo de tempo coerente', () => {
    const samples = synth(1, [{ startSec: 0, durationSec: 1, freqStartHz: 3000 }]);
    const spec = computeSpectrogram(samples, SR, { fftSize: 1024, hopSize: 256 });
    expect(spec.binFreqs[0]).toBeGreaterThanOrEqual(250);
    expect(spec.binFreqs[spec.binFreqs.length - 1]).toBeLessThanOrEqual(SR / 2);
    expect(spec.magnitudes.length).toBeGreaterThan(50);
    const last = spec.frameTimes[spec.frameTimes.length - 1];
    expect(last).toBeGreaterThan(0.8);
    expect(last).toBeLessThanOrEqual(1.0);
  });
});

describe('extracao de features', () => {
  it('mede a frequencia dominante de um assobio puro', () => {
    const samples = synth(2, [
      { startSec: 0.2, durationSec: 0.4, freqStartHz: 3000 },
      { startSec: 1.0, durationSec: 0.4, freqStartHz: 3000 },
    ]);
    const { features } = extractFeatures(samples, SR);
    expect(features.peakHz).toBeGreaterThan(2700);
    expect(features.peakHz).toBeLessThan(3300);
    expect(features.tonality).toBeGreaterThan(0.4);
  });

  it('conta as notas emitidas', () => {
    const tones: ToneSpec[] = [];
    for (let i = 0; i < 6; i++) {
      tones.push({ startSec: 0.2 + i * 0.3, durationSec: 0.12, freqStartHz: 3500 });
    }
    const { features } = extractFeatures(synth(2.5, tones), SR);
    expect(features.noteCount).toBeGreaterThanOrEqual(5);
    expect(features.noteCount).toBeLessThanOrEqual(7);
    expect(features.noteRate).toBeGreaterThan(2.5);
    expect(features.noteRate).toBeLessThan(4.5);
  });

  it('separa som tonal de som ruidoso', () => {
    const pure = extractFeatures(synth(1.5, [{ startSec: 0.2, durationSec: 0.6, freqStartHz: 2500 }]), SR).features;
    const harsh = extractFeatures(
      synth(1.5, [{ startSec: 0.2, durationSec: 0.6, freqStartHz: 2500, noisiness: 0.95 }]),
      SR,
    ).features;
    expect(pure.tonality).toBeGreaterThan(harsh.tonality);
    expect(harsh.bandwidthHz).toBeGreaterThan(pure.bandwidthHz);
  });

  it('detecta modulacao de frequencia numa nota varrida', () => {
    const flat = extractFeatures(synth(1.5, [{ startSec: 0.2, durationSec: 0.6, freqStartHz: 3000 }]), SR).features;
    const sweep = extractFeatures(
      synth(1.5, [{ startSec: 0.2, durationSec: 0.6, freqStartHz: 2000, freqEndHz: 5000 }]),
      SR,
    ).features;
    expect(sweep.fmDepth).toBeGreaterThan(flat.fmDepth);
    expect(sweep.notes[0].sweepHzPerSec).toBeGreaterThan(500);
  });

  it('reconhece trinado rapido e regular', () => {
    const tones: ToneSpec[] = [];
    for (let i = 0; i < 24; i++) tones.push({ startSec: 0.2 + i * 0.07, durationSec: 0.035, freqStartHz: 4200 });
    const { features } = extractFeatures(synth(2.2, tones), SR);
    expect(features.noteRate).toBeGreaterThan(9);
    expect(features.trillIndex).toBeGreaterThan(0.2);
    expect(features.rhythmIrregularity).toBeLessThan(0.3);
  });

  it('mede estereotipia alta em notas identicas repetidas', () => {
    const same: ToneSpec[] = [];
    const varied: ToneSpec[] = [];
    for (let i = 0; i < 8; i++) {
      same.push({ startSec: 0.15 + i * 0.35, durationSec: 0.18, freqStartHz: 3000, freqEndHz: 3600 });
      varied.push({
        startSec: 0.15 + i * 0.35,
        durationSec: 0.18,
        freqStartHz: 2000 + i * 350,
        freqEndHz: 5000 - i * 300,
      });
    }
    const a = extractFeatures(synth(3.2, same), SR).features;
    const b = extractFeatures(synth(3.2, varied), SR).features;
    expect(a.stereotypy).toBeGreaterThan(b.stereotypy);
    expect(b.noteDiversity).toBeGreaterThan(a.noteDiversity);
  });
});

describe('classificacao do tipo de canto', () => {
  it('le frase longa, repetida e estereotipada como territorio', () => {
    const tones: ToneSpec[] = [];
    // 4 frases identicas de 3 notas flauteadas, espacadas regularmente
    for (let phrase = 0; phrase < 4; phrase++) {
      const base = 0.3 + phrase * 2.0;
      tones.push({ startSec: base, durationSec: 0.3, freqStartHz: 2200, freqEndHz: 2600, amplitude: 0.6 });
      tones.push({ startSec: base + 0.5, durationSec: 0.3, freqStartHz: 2800, freqEndHz: 2500, amplitude: 0.6 });
      tones.push({ startSec: base + 1.0, durationSec: 0.35, freqStartHz: 2400, freqEndHz: 2200, amplitude: 0.6 });
    }
    const { features } = extractFeatures(synth(8.5, tones), SR);
    const result = classifySongType(features);
    expect(['territorio', 'corte']).toContain(result.top.type);
    const territorio = result.scores.find((s) => s.type === 'territorio')!;
    expect(territorio.probability).toBeGreaterThan(0.15);
    expect(result.scores.reduce((a, s) => a + s.probability, 0)).toBeCloseTo(1, 5);
  });

  it('le rajada aspera, curta e de banda larga como alarme', () => {
    const tones: ToneSpec[] = [];
    for (let i = 0; i < 14; i++) {
      tones.push({
        startSec: 0.2 + i * 0.13,
        durationSec: 0.05,
        freqStartHz: 2500,
        freqEndHz: 3800,
        noisiness: 0.85,
        amplitude: 0.8,
      });
    }
    const { features } = extractFeatures(synth(2.5, tones), SR);
    const result = classifySongType(features);
    const alarme = result.scores.find((s) => s.type === 'alarme')!;
    const corte = result.scores.find((s) => s.type === 'corte')!;
    expect(alarme.probability).toBeGreaterThan(corte.probability);
  });

  it('le nota aguda, unica e de banda estreita como alarme ou contato, nunca corte', () => {
    const { features } = extractFeatures(
      synth(2.0, [{ startSec: 0.6, durationSec: 0.09, freqStartHz: 8000, amplitude: 0.5 }]),
      SR,
    );
    const result = classifySongType(features);
    expect(['alarme', 'contato']).toContain(result.top.type);
    expect(result.top.type).not.toBe('corte');
  });

  it('le trinado longo, largo e variado como corte', () => {
    const tones: ToneSpec[] = [];
    for (let i = 0; i < 40; i++) {
      const f = 2500 + (i % 7) * 700;
      tones.push({
        startSec: 0.2 + i * 0.075,
        durationSec: 0.055,
        freqStartHz: f,
        freqEndHz: f + 1400,
        amplitude: 0.4 + i * 0.012,
      });
    }
    const { features } = extractFeatures(synth(3.6, tones), SR);
    const result = classifySongType(features);
    const corte = result.scores.find((s) => s.type === 'corte')!;
    const contato = result.scores.find((s) => s.type === 'contato')!;
    expect(corte.probability).toBeGreaterThan(contato.probability);
  });

  it('avisa quando o trecho e curto demais para ler a funcao', () => {
    const { features } = extractFeatures(synth(1.0, [{ startSec: 0.4, durationSec: 0.1, freqStartHz: 4000 }]), SR);
    const result = classifySongType(features);
    expect(result.caveats.length).toBeGreaterThan(0);
    expect(result.confidence).toBeLessThan(0.75);
  });

  it('respeita o prior da especie sem sobrepor a evidencia acustica', () => {
    const tones: ToneSpec[] = [];
    for (let i = 0; i < 14; i++) {
      tones.push({ startSec: 0.2 + i * 0.13, durationSec: 0.05, freqStartHz: 3000, noisiness: 0.85 });
    }
    const { features } = extractFeatures(synth(2.5, tones), SR);
    const neutral = classifySongType(features);
    const biased = classifySongType(features, { alarme: 1 });
    const alarmeN = neutral.scores.find((s) => s.type === 'alarme')!.probability;
    const alarmeB = biased.scores.find((s) => s.type === 'alarme')!.probability;
    expect(alarmeB).toBeGreaterThanOrEqual(alarmeN);
  });
});

describe('DTW', () => {
  it('da similaridade maxima para contornos identicos', () => {
    const a = [0.1, 0.4, 0.9, 0.5, 0.2];
    expect(dtwSimilarity(a, a)).toBeCloseTo(1, 5);
  });

  it('tolera esticamento no tempo', () => {
    const a = [0.1, 0.5, 0.9, 0.4];
    const stretched = [0.1, 0.1, 0.5, 0.5, 0.9, 0.9, 0.4, 0.4];
    expect(dtwSimilarity(a, stretched)).toBeGreaterThan(0.85);
  });

  it('separa contornos opostos', () => {
    const rising = [0.1, 0.3, 0.6, 0.9];
    const falling = [0.9, 0.6, 0.3, 0.1];
    expect(dtwSimilarity(rising, falling)).toBeLessThan(dtwSimilarity(rising, rising));
  });
});

describe('identificacao de especie', () => {
  it('devolve probabilidades normalizadas e ordenadas', () => {
    const { features } = extractFeatures(
      synth(3, [
        { startSec: 0.3, durationSec: 0.3, freqStartHz: 2200, freqEndHz: 2600 },
        { startSec: 1.0, durationSec: 0.3, freqStartHz: 2800, freqEndHz: 2400 },
        { startSec: 1.8, durationSec: 0.3, freqStartHz: 2300, freqEndHz: 2100 },
      ]),
      SR,
    );
    const result = matchSpecies(features);
    expect(result.matches.length).toBe(5);
    const sum = result.matches.reduce((a, m) => a + m.probability, 0);
    expect(sum).toBeCloseTo(1, 5);
    for (let i = 1; i < result.matches.length; i++) {
      expect(result.matches[i - 1].probability).toBeGreaterThanOrEqual(result.matches[i].probability);
    }
  });

  it('prefere especies graves quando o canto e grave', () => {
    const { features } = extractFeatures(
      synth(3, [
        { startSec: 0.3, durationSec: 0.3, freqStartHz: 600 },
        { startSec: 0.9, durationSec: 0.35, freqStartHz: 560 },
        { startSec: 1.7, durationSec: 0.3, freqStartHz: 600 },
        { startSec: 2.3, durationSec: 0.35, freqStartHz: 560 },
      ]),
      SR,
    );
    const result = matchSpecies(features);
    const top = result.matches[0].species;
    expect(top.acoustic.peakHz[0]).toBeLessThan(2000);
  });

  it('prefere especies agudas quando o canto e agudo e trinado', () => {
    const tones: ToneSpec[] = [];
    for (let i = 0; i < 30; i++) tones.push({ startSec: 0.2 + i * 0.06, durationSec: 0.03, freqStartHz: 6500 });
    const { features } = extractFeatures(synth(2.4, tones), SR);
    const result = matchSpecies(features);
    expect(result.matches[0].species.acoustic.peakHz[1]).toBeGreaterThan(4000);
  });

  it('marca como inconclusivo quando so ha silencio', () => {
    const silence = new Float32Array(SR * 2);
    const { features } = extractFeatures(silence, SR);
    const result = matchSpecies(features);
    expect(result.inconclusive).toBe(true);
    expect(result.notes.length).toBeGreaterThan(0);
  });

  it('respeita o filtro de candidatos', () => {
    const { features } = extractFeatures(synth(2, [{ startSec: 0.3, durationSec: 0.4, freqStartHz: 3000 }]), SR);
    const result = matchSpecies(features, { topN: 2 });
    expect(result.matches.length).toBe(2);
  });
});
