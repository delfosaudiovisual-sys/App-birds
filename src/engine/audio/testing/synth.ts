import type { Species } from '../../../data/types';

/**
 * Sintetizador de vocalizacoes para o banco de provas.
 *
 * Nao e um simulador de ave: e um gerador de sinais que carregam a mesma
 * ESTRUTURA descrita no perfil da especie (faixa de altura, ritmo, timbre,
 * contorno melodico), degradados como uma gravacao de campo degrada — ruido de
 * fundo, distancia, desafinacao, variacao de andamento, trecho cortado.
 *
 * Serve para medir DISCRIMINABILIDADE e ROBUSTEZ: se duas especies da base sao
 * distinguiveis pelo motor, e se o acerto sobrevive a degradacao. Nao mede
 * acerto de campo — para isso so gravacao real etiquetada serve.
 */

/** Gerador determinista: o mesmo seed sempre da o mesmo sinal. */
export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = (seed >>> 0) || 1;
  }

  next(): number {
    // xorshift32
    let x = this.state;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.state = x >>> 0;
    return this.state / 0xffffffff;
  }

  /** Uniforme em [min, max]. */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Normal aproximada por soma de uniformes. */
  normal(mean: number, sd: number): number {
    const u = this.next() + this.next() + this.next() - 1.5;
    return mean + u * sd * 1.4;
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length) % items.length];
  }
}

export interface Degradation {
  /** relacao sinal/ruido alvo, em dB. Menor = mais longe / mais barulho */
  snrDb: number;
  /** multiplicador de altura: 0.9 = canta 10% mais grave que o tipico */
  pitchScale: number;
  /** multiplicador de andamento: 1.3 = 30% mais rapido */
  tempoScale: number;
  /** fracao do trecho que sobra (1 = completo, 0.4 = so 40% capturado) */
  coverage: number;
  /** atenuacao de agudos, imitando distancia e folhagem (0 = nenhuma) */
  highCut: number;
  /** jitter por nota: quanto cada nota desvia do modelo */
  jitter: number;
}

export const CLEAN: Degradation = {
  snrDb: 30,
  pitchScale: 1,
  tempoScale: 1,
  coverage: 1,
  highCut: 0,
  jitter: 0.04,
};

export interface SynthResult {
  samples: Float32Array;
  sampleRate: number;
}

/** Filtro passa-baixa de 1a ordem, imitando a absorcao de agudos pela distancia. */
function lowpass(samples: Float32Array, sampleRate: number, cutoffHz: number): void {
  const rc = 1 / (2 * Math.PI * cutoffHz);
  const dt = 1 / sampleRate;
  const alpha = dt / (rc + dt);
  let prev = samples[0] ?? 0;
  for (let i = 0; i < samples.length; i++) {
    prev += alpha * (samples[i] - prev);
    samples[i] = prev;
  }
}

/**
 * Ruido de fundo de campo: rosa (mais energia nos graves, como vento e
 * transito) com um pouco de branco por cima.
 */
function fieldNoise(length: number, rng: Rng): Float32Array {
  const out = new Float32Array(length);
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  for (let i = 0; i < length; i++) {
    const white = rng.next() * 2 - 1;
    b0 = 0.99765 * b0 + white * 0.099046;
    b1 = 0.963 * b1 + white * 0.2965164;
    b2 = 0.57 * b2 + white * 1.0526913;
    out[i] = (b0 + b1 + b2 + white * 0.1848) * 0.22 + white * 0.08;
  }
  return out;
}

function rms(samples: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / Math.max(1, samples.length));
}

function amostraContorno(motif: number[] | undefined, t: number): number {
  if (!motif || motif.length === 0) return 0.5;
  const pos = t * (motif.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.min(motif.length - 1, lo + 1);
  return motif[lo] + (motif[hi] - motif[lo]) * (pos - lo);
}

/**
 * Espaca as notas conforme a classe ritmica declarada. Um "serie-acelerada"
 * (joao-de-barro, choca) tem intervalos que encurtam; um trinado e metronomico;
 * um "irregular" (sanhaco, arara) tem intervalos sorteados.
 */
function intervals(species: Species, count: number, baseInterval: number, rng: Rng, jitter: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const progress = count > 1 ? i / (count - 1) : 0;
    let interval = baseInterval;
    switch (species.acoustic.rhythm) {
      case 'serie-acelerada':
        // acelera ate ~55% do intervalo inicial e volta a abrir no fim
        interval = baseInterval * (1 - 0.45 * Math.sin(progress * Math.PI * 0.85));
        break;
      case 'trinado':
      case 'serie-regular':
        interval = baseInterval;
        break;
      case 'irregular':
        interval = baseInterval * rng.range(0.45, 1.9);
        break;
      case 'nota-isolada':
        interval = baseInterval * rng.range(0.85, 1.3);
        break;
      default:
        interval = baseInterval * rng.range(0.85, 1.2);
    }
    out.push(Math.max(0.015, interval * rng.normal(1, jitter)));
  }
  return out;
}

export interface SynthOptions {
  sampleRate?: number;
  seed?: number;
  degradation?: Partial<Degradation>;
  /** quantas repeticoes da frase cabem no trecho */
  phrases?: number;
}

export function synthesizeSpecies(species: Species, options: SynthOptions = {}): SynthResult {
  const sampleRate = options.sampleRate ?? 32000;
  const rng = new Rng(options.seed ?? 1);
  const deg: Degradation = { ...CLEAN, ...options.degradation };
  const a = species.acoustic;

  const notesPerPhrase = a.notesPerPhrase
    ? Math.max(1, Math.round(rng.range(a.notesPerPhrase[0], Math.min(a.notesPerPhrase[1], 26))))
    : 6;
  const noteDur = rng.range(a.noteDurationSec[0], a.noteDurationSec[1]) / deg.tempoScale;
  const noteRate = rng.range(a.noteRate[0], a.noteRate[1]) * deg.tempoScale;
  const baseInterval = Math.max(noteDur * 1.05, 1 / Math.max(0.2, noteRate));

  const centerHz = rng.range(a.peakHz[0], a.peakHz[1]) * deg.pitchScale;
  const fmDepth = rng.range(a.fmDepth[0], a.fmDepth[1]);
  const tonality = rng.range(a.tonality[0], a.tonality[1]);

  const phrases = options.phrases ?? (a.rhythm === 'nota-isolada' ? 3 : 2);
  const gaps = intervals(species, notesPerPhrase, baseInterval, rng, deg.jitter);
  const phraseSpan = gaps.reduce((s, g) => s + g, 0) + noteDur;
  const phrasePause = Math.max(0.35, rng.range(0.4, 1.2) / deg.tempoScale);
  const totalSec = phrases * (phraseSpan + phrasePause) + 0.4;

  const length = Math.ceil(totalSec * sampleRate);
  const voice = new Float32Array(length);

  // Aves tem serie harmonica; quanto mais tonal, mais a energia se concentra na
  // fundamental. Um som aspero espalha energia por harmonicas altas e ruido.
  const harmonicCount = tonality > 0.6 ? 3 : tonality > 0.3 ? 5 : 7;

  for (let phrase = 0; phrase < phrases; phrase++) {
    let cursor = 0.2 + phrase * (phraseSpan + phrasePause);
    for (let n = 0; n < notesPerPhrase; n++) {
      const progress = notesPerPhrase > 1 ? n / (notesPerPhrase - 1) : 0.5;
      const contourAt = amostraContorno(a.motif, progress);
      // o motivo posiciona a nota dentro de uma janela de +-fmDepth em torno do centro
      // O motivo posiciona a nota dentro de +-25% em torno do centro da especie;
      // fmDepth controla a varredura DENTRO da nota. Sao coisas diferentes:
      // misturar as duas fazia a sintese estourar a banda declarada no perfil.
      const noteCenter = centerHz * (1 + (contourAt - 0.5) * 0.5) * rng.normal(1, deg.jitter);
      const sweep = fmDepth * (amostraContorno(a.motif, Math.min(1, progress + 0.15)) > contourAt ? 1 : -1);
      const dur = noteDur * rng.normal(1, deg.jitter);
      const amp = rng.range(0.55, 0.9);

      const start = Math.round(cursor * sampleRate);
      const samples = Math.max(8, Math.round(dur * sampleRate));
      let phase = 0;
      for (let i = 0; i < samples; i++) {
        const idx = start + i;
        if (idx >= length) break;
        const t = i / samples;
        // varredura centrada: a nota vai de center*(1-fm/2) a center*(1+fm/2)
        const f = Math.max(120, noteCenter * (1 + sweep * (t - 0.5)));
        phase += (2 * Math.PI * f) / sampleRate;

        let value = 0;
        for (let h = 1; h <= harmonicCount; h++) {
          // energia caindo com a ordem do harmonico; cai mais rapido se tonal
          const weight = 1 / h ** (tonality > 0.5 ? 2.2 : 1.3);
          value += Math.sin(phase * h) * weight;
        }
        value *= tonality;
        value += (rng.next() * 2 - 1) * (1 - tonality) * 1.1;

        // envelope com ataque rapido e queda suave, como um som de siringe
        const env = Math.min(1, t * 22) * (1 - t) ** 0.55;
        voice[idx] += value * env * amp * 0.35;
      }
      cursor += gaps[n];
    }
  }

  // Trecho parcial: quem grava no campo quase nunca pega a frase inteira.
  let cut = voice;
  if (deg.coverage < 1) {
    const keep = Math.max(Math.round(length * deg.coverage), Math.round(0.35 * sampleRate));
    const offset = Math.floor((length - keep) * rng.next());
    cut = voice.slice(offset, offset + keep);
  }

  // Distancia: a folhagem e o ar absorvem agudos antes dos graves.
  if (deg.highCut > 0) {
    lowpass(cut, sampleRate, Math.max(1200, 14000 * (1 - deg.highCut)));
  }

  // Ruido no nivel pedido, medido contra o RMS do que sobrou de sinal.
  const noise = fieldNoise(cut.length, rng);
  const signalRms = rms(cut) || 1e-6;
  const targetNoiseRms = signalRms / 10 ** (deg.snrDb / 20);
  const noiseGain = targetNoiseRms / (rms(noise) || 1e-6);

  const out = new Float32Array(cut.length);
  for (let i = 0; i < cut.length; i++) {
    out[i] = Math.max(-1, Math.min(1, cut[i] + noise[i] * noiseGain));
  }

  return { samples: out, sampleRate };
}
