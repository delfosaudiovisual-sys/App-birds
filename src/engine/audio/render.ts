import type { Spectrogram } from './spectrogram';

/**
 * Paleta do espectrograma: escura no silencio, verde-agua na energia media,
 * ambar no pico. Escolhida para manter contraste legivel em tela de celular
 * sob luz do sol, que e onde o app vai ser usado.
 */
function colorFor(v: number): [number, number, number] {
  const stops: [number, [number, number, number]][] = [
    [0.0, [12, 18, 22]],
    [0.25, [16, 52, 62]],
    [0.5, [24, 122, 112]],
    [0.72, [126, 186, 92]],
    [0.88, [232, 178, 58]],
    [1.0, [246, 240, 226]],
  ];
  for (let i = 1; i < stops.length; i++) {
    if (v <= stops[i][0]) {
      const [p0, c0] = stops[i - 1];
      const [p1, c1] = stops[i];
      const t = (v - p0) / (p1 - p0 || 1);
      return [c0[0] + (c1[0] - c0[0]) * t, c0[1] + (c1[1] - c0[1]) * t, c0[2] + (c1[2] - c0[2]) * t];
    }
  }
  return stops[stops.length - 1][1];
}

export interface RenderOptions {
  width?: number;
  height?: number;
  dynamicRangeDb?: number;
  /** eixo de frequencia em escala log: aproxima a percepcao e abre os graves */
  logScale?: boolean;
}

/**
 * Desenha o espectrograma num canvas. Tempo no eixo X, frequencia no Y
 * (grave embaixo).
 */
export function drawSpectrogram(
  canvas: HTMLCanvasElement,
  spec: Spectrogram,
  options: RenderOptions = {},
): void {
  const width = options.width ?? canvas.width;
  const height = options.height ?? canvas.height;
  const range = options.dynamicRangeDb ?? 55;
  const log = options.logScale ?? true;

  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const frames = spec.magnitudes.length;
  const bins = spec.binFreqs.length;
  if (frames === 0 || bins === 0) {
    ctx.fillStyle = '#0c1216';
    ctx.fillRect(0, 0, width, height);
    return;
  }

  let peak = 1e-9;
  for (const row of spec.magnitudes) for (const v of row) if (v > peak) peak = v;

  const minHz = spec.binFreqs[0];
  const maxHz = spec.binFreqs[bins - 1];
  const logMin = Math.log2(Math.max(minHz, 1));
  const logMax = Math.log2(Math.max(maxHz, minHz + 1));

  const image = ctx.createImageData(width, height);

  for (let x = 0; x < width; x++) {
    const f = Math.min(frames - 1, Math.floor((x / width) * frames));
    const row = spec.magnitudes[f];
    for (let y = 0; y < height; y++) {
      // y = 0 no topo, mas queremos agudo no topo
      const t = 1 - y / (height - 1 || 1);
      const hz = log ? 2 ** (logMin + (logMax - logMin) * t) : minHz + (maxHz - minHz) * t;
      const bin = Math.min(bins - 1, Math.max(0, Math.round(((hz - minHz) / (maxHz - minHz || 1)) * (bins - 1))));
      const db = 20 * Math.log10(Math.max(row[bin], 1e-9) / peak);
      const norm = Math.max(0, Math.min(1, 1 + db / range));
      const [r, g, b] = colorFor(norm);
      const i = (y * width + x) * 4;
      image.data[i] = r;
      image.data[i + 1] = g;
      image.data[i + 2] = b;
      image.data[i + 3] = 255;
    }
  }

  ctx.putImageData(image, 0, 0);
}

/** Espectrograma reduzido, em PNG, para a ficha da pokedex. */
export function spectrogramThumbnail(spec: Spectrogram, width = 320, height = 120): string {
  if (typeof document === 'undefined') return '';
  const canvas = document.createElement('canvas');
  drawSpectrogram(canvas, spec, { width, height });
  try {
    return canvas.toDataURL('image/png');
  } catch {
    return '';
  }
}
