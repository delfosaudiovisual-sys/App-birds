/**
 * FFT radix-2 iterativa (in-place, Cooley-Tukey) mais utilitarios de janelamento.
 * Escrita a mao para nao carregar dependencia: o custo importa porque o
 * espectrograma roda no celular, em tempo real, durante a gravacao.
 */

const twiddleCache = new Map<number, { cos: Float32Array; sin: Float32Array }>();
const reverseCache = new Map<number, Uint32Array>();

function twiddles(n: number) {
  const cached = twiddleCache.get(n);
  if (cached) return cached;
  const half = n >> 1;
  const cos = new Float32Array(half);
  const sin = new Float32Array(half);
  for (let i = 0; i < half; i++) {
    cos[i] = Math.cos((-2 * Math.PI * i) / n);
    sin[i] = Math.sin((-2 * Math.PI * i) / n);
  }
  const entry = { cos, sin };
  twiddleCache.set(n, entry);
  return entry;
}

function bitReversal(n: number) {
  const cached = reverseCache.get(n);
  if (cached) return cached;
  const bits = Math.log2(n) | 0;
  const table = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    let rev = 0;
    for (let b = 0; b < bits; b++) if (i & (1 << b)) rev |= 1 << (bits - 1 - b);
    table[i] = rev;
  }
  reverseCache.set(n, table);
  return table;
}

/** FFT complexa in-place. `re`/`im` precisam ter comprimento potencia de 2. */
export function fftInPlace(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  if (n <= 1) return;
  if ((n & (n - 1)) !== 0) throw new Error(`FFT exige potencia de 2, recebeu ${n}`);

  const rev = bitReversal(n);
  for (let i = 0; i < n; i++) {
    const j = rev[i];
    if (j > i) {
      let t = re[i];
      re[i] = re[j];
      re[j] = t;
      t = im[i];
      im[i] = im[j];
      im[j] = t;
    }
  }

  const { cos, sin } = twiddles(n);
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const step = n / size;
    for (let i = 0; i < n; i += size) {
      for (let j = 0, k = 0; j < half; j++, k += step) {
        const c = cos[k];
        const s = sin[k];
        const a = i + j;
        const b = a + half;
        const tre = re[b] * c - im[b] * s;
        const tim = re[b] * s + im[b] * c;
        re[b] = re[a] - tre;
        im[b] = im[a] - tim;
        re[a] += tre;
        im[a] += tim;
      }
    }
  }
}

/** Magnitude do espectro de um bloco real. Devolve n/2+1 bins. */
export function magnitudeSpectrum(frame: Float32Array, scratch?: { re: Float32Array; im: Float32Array }): Float32Array {
  const n = frame.length;
  const re = scratch?.re ?? new Float32Array(n);
  const im = scratch?.im ?? new Float32Array(n);
  re.set(frame);
  im.fill(0);
  fftInPlace(re, im);
  const bins = (n >> 1) + 1;
  const out = new Float32Array(bins);
  for (let i = 0; i < bins; i++) out[i] = Math.hypot(re[i], im[i]);
  return out;
}

const windowCache = new Map<string, Float32Array>();

export function hannWindow(n: number): Float32Array {
  const key = `hann:${n}`;
  const cached = windowCache.get(key);
  if (cached) return cached;
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
  windowCache.set(key, w);
  return w;
}

/** Proxima potencia de 2 maior ou igual a `v`. */
export function nextPow2(v: number): number {
  let p = 1;
  while (p < v) p <<= 1;
  return p;
}
