import { describe, it } from 'vitest';
import { computeSpectrogram } from './spectrogram';

function conc(row: Float32Array): number {
  const n = row.length; let total = 0;
  const p = new Float64Array(n);
  for (let b = 0; b < n; b++) { p[b] = row[b] * row[b]; total += p[b]; }
  if (total <= 0) return 0;
  p.sort();
  const keep = Math.max(1, Math.round(n * 0.04));
  let top = 0; for (let i = n - keep; i < n; i++) top += p[i];
  return top / total;
}
function bandFrac(row: Float32Array, freqs: Float32Array, maskDb: number) {
  let peak = 0; for (const v of row) if (v > peak) peak = v;
  const thr = peak * 10 ** (maskDb / 20);
  let total = 0; for (let b = 0; b < row.length; b++) if (row[b] >= thr) total += row[b]*row[b];
  if (total <= 0) return [0,0];
  let acc = 0, lo = freqs[0], hi = freqs[freqs.length-1], set = false;
  for (let b = 0; b < row.length; b++) {
    if (row[b] < thr) continue;
    acc += row[b]*row[b];
    if (!set && acc >= total*0.05) { lo = freqs[b]; set = true; }
    if (acc >= total*0.95) { hi = freqs[b]; break; }
  }
  return [lo, hi];
}

const SR = 32000;
function gen(kind: 'tom'|'harm'|'ruido', f0 = 2500) {
  const n = SR;
  const out = new Float32Array(n);
  let seed = 7;
  const rnd = () => { seed = (seed*1103515245+12345)&0x7fffffff; return seed/0x7fffffff-0.5; };
  for (let i = 0; i < n; i++) {
    // notas de 150 ms a cada 400 ms, mais ruido de fundo a -25 dB
    const t = (i / SR) % 0.4;
    const on = t < 0.15 ? Math.sin(Math.PI * t / 0.15) : 0;
    let v = 0;
    if (kind === 'ruido') v = rnd() * 2;
    else if (kind === 'tom') v = Math.sin(2*Math.PI*f0*i/SR);
    else { for(let h=1;h<=4;h++) v += Math.sin(2*Math.PI*f0*h*i/SR)/h**2.2; }
    out[i] = v * on * 0.6 + rnd() * 0.034;
  }
  return out;
}

describe('calibracao', () => {
  it('mede concentracao e banda', () => {
    for (const kind of ['tom','harm','ruido'] as const) {
      const spec = computeSpectrogram(gen(kind), SR, { fftSize: 2048, hopSize: 512 });
      const mid = spec.magnitudes[Math.floor(spec.magnitudes.length/2)];
      const cs: number[] = []; for (const r of spec.magnitudes) cs.push(conc(r));
      cs.sort((a,b)=>a-b);
      const med = cs[Math.floor(cs.length/2)];
      console.log(`${kind.padEnd(6)} concentracao ${med.toFixed(4)}` +
        `  banda(-inf) ${bandFrac(mid, spec.binFreqs, -200).map(v=>v.toFixed(0)).join('-')}` +
        `  banda(-20dB) ${bandFrac(mid, spec.binFreqs, -20).map(v=>v.toFixed(0)).join('-')}` +
        `  banda(-30dB) ${bandFrac(mid, spec.binFreqs, -30).map(v=>v.toFixed(0)).join('-')}`);
    }
  });
});
