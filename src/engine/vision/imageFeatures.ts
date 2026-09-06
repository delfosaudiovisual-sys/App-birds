import { rgbToHex, rgbToLab, deltaE, type Lab } from './color';

export interface RawImage {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export interface ColorCluster {
  lab: Lab;
  hex: string;
  /** fracao dos pixels do sujeito */
  share: number;
}

export interface ImageFeatures {
  /** paleta dominante do sujeito, ordenada por participacao */
  palette: ColorCluster[];
  /** cores medias por faixa vertical do sujeito (topo -> base) */
  bands: { hex: string; lab: Lab }[];
  /** 0-1, densidade de bordas internas: distingue plumagem lisa de rajada */
  edgeDensity: number;
  /** 0-1, contraste de luminancia dentro do sujeito */
  contrast: number;
  /** largura/altura do recorte do sujeito */
  aspectRatio: number;
  /** fracao da imagem ocupada pelo sujeito */
  subjectShare: number;
  /** 0-1, quanto o sujeito se destaca do fundo */
  separability: number;
  /** 0-1, periodicidade horizontal das bordas: alto = barrado/listrado */
  banding: number;
}

const SAMPLE_SIZE = 128;

/** Reamostra para SAMPLE_SIZE mantendo proporcao (vizinho mais proximo, rapido). */
function downscale(img: RawImage): RawImage {
  const scale = Math.min(1, SAMPLE_SIZE / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  if (w === img.width && h === img.height) return img;

  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(img.height - 1, Math.floor((y / h) * img.height));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(img.width - 1, Math.floor((x / w) * img.width));
      const si = (sy * img.width + sx) * 4;
      const di = (y * w + x) * 4;
      out[di] = img.data[si];
      out[di + 1] = img.data[si + 1];
      out[di + 2] = img.data[si + 2];
      out[di + 3] = img.data[si + 3];
    }
  }
  return { data: out, width: w, height: h };
}

/**
 * Mascara do sujeito. Sem rede neural nao da pra segmentar de verdade, entao
 * combinamos duas pistas que funcionam bem em foto de ave: o fundo costuma
 * estar nas bordas do quadro (ceu, folhagem desfocada) e o assunto costuma
 * estar no centro. Pixels parecidos com a cor de borda perdem peso.
 */
function subjectMask(img: RawImage): { mask: Float32Array; separability: number } {
  const { data, width, height } = img;
  const border: Lab[] = [];
  const step = Math.max(1, Math.floor(Math.min(width, height) / 32));

  for (let x = 0; x < width; x += step) {
    for (const y of [0, height - 1]) {
      const i = (y * width + x) * 4;
      border.push(rgbToLab(data[i], data[i + 1], data[i + 2]));
    }
  }
  for (let y = 0; y < height; y += step) {
    for (const x of [0, width - 1]) {
      const i = (y * width + x) * 4;
      border.push(rgbToLab(data[i], data[i + 1], data[i + 2]));
    }
  }

  const bg: Lab = {
    L: mean(border.map((c) => c.L)),
    a: mean(border.map((c) => c.a)),
    b: mean(border.map((c) => c.b)),
  };

  const mask = new Float32Array(width * height);
  const cx = width / 2;
  const cy = height / 2;
  const maxR = Math.hypot(cx, cy);
  let sumDist = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (data[i + 3] < 16) continue;
      const lab = rgbToLab(data[i], data[i + 1], data[i + 2]);
      const dist = deltaE(lab, bg);
      sumDist += dist;
      const colorWeight = Math.min(1, dist / 28);
      const r = Math.hypot(x - cx, y - cy) / maxR;
      const centerWeight = Math.max(0.15, 1 - r * r);
      mask[y * width + x] = colorWeight * centerWeight;
    }
  }

  const avgDist = sumDist / (width * height);
  return { mask, separability: Math.min(1, avgDist / 35) };
}

function mean(v: number[]): number {
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0;
}

/** k-means em Lab, com pesos vindos da mascara do sujeito. */
function clusterColors(img: RawImage, mask: Float32Array, k: number): ColorCluster[] {
  const { data, width, height } = img;
  const points: { lab: Lab; w: number }[] = [];
  for (let p = 0; p < width * height; p++) {
    const w = mask[p];
    if (w < 0.18) continue;
    const i = p * 4;
    points.push({ lab: rgbToLab(data[i], data[i + 1], data[i + 2]), w });
  }
  if (points.length === 0) return [];

  // Inicializacao determinista tipo k-means++ (sem aleatoriedade: o mesmo
  // retrato precisa dar sempre o mesmo resultado).
  const centers: Lab[] = [points[0].lab];
  while (centers.length < k) {
    let best = points[0];
    let bestD = -1;
    for (const p of points) {
      let d = Infinity;
      for (const c of centers) d = Math.min(d, deltaE(p.lab, c));
      const score = d * p.w;
      if (score > bestD) {
        bestD = score;
        best = p;
      }
    }
    if (bestD <= 0) break;
    centers.push(best.lab);
  }

  const assign = new Int32Array(points.length);
  for (let iter = 0; iter < 12; iter++) {
    let moved = false;
    for (let i = 0; i < points.length; i++) {
      let bi = 0;
      let bd = Infinity;
      for (let c = 0; c < centers.length; c++) {
        const d = deltaE(points[i].lab, centers[c]);
        if (d < bd) {
          bd = d;
          bi = c;
        }
      }
      if (assign[i] !== bi) {
        assign[i] = bi;
        moved = true;
      }
    }
    const sums = centers.map(() => ({ L: 0, a: 0, b: 0, w: 0 }));
    for (let i = 0; i < points.length; i++) {
      const s = sums[assign[i]];
      const { lab, w } = points[i];
      s.L += lab.L * w;
      s.a += lab.a * w;
      s.b += lab.b * w;
      s.w += w;
    }
    for (let c = 0; c < centers.length; c++) {
      if (sums[c].w > 0) {
        centers[c] = { L: sums[c].L / sums[c].w, a: sums[c].a / sums[c].w, b: sums[c].b / sums[c].w };
      }
    }
    if (!moved) break;
  }

  const weights = centers.map(() => 0);
  for (let i = 0; i < points.length; i++) weights[assign[i]] += points[i].w;
  const total = weights.reduce((a, b) => a + b, 0) || 1;

  return centers
    .map((lab, i) => ({ lab, hex: labToHex(lab), share: weights[i] / total }))
    .filter((c) => c.share > 0.02)
    .sort((a, b) => b.share - a.share);
}

function labToHex(lab: Lab): string {
  // Lab -> XYZ -> sRGB
  const fy = (lab.L + 16) / 116;
  const fx = fy + lab.a / 500;
  const fz = fy - lab.b / 200;
  const inv = (t: number) => (t ** 3 > 0.008856 ? t ** 3 : (t - 16 / 116) / 7.787);
  const x = inv(fx) * 0.95047;
  const y = inv(fy);
  const z = inv(fz) * 1.08883;

  let r = x * 3.2404542 + y * -1.5371385 + z * -0.4985314;
  let g = x * -0.969266 + y * 1.8760108 + z * 0.041556;
  let b = x * 0.0556434 + y * -0.2040259 + z * 1.0572252;

  const gamma = (c: number) => (c > 0.0031308 ? 1.055 * c ** (1 / 2.4) - 0.055 : 12.92 * c);
  r = gamma(r) * 255;
  g = gamma(g) * 255;
  b = gamma(b) * 255;
  return rgbToHex(r, g, b);
}

/** Sobel simples sobre a luminancia, restrito ao sujeito. */
function edgeStats(img: RawImage, mask: Float32Array) {
  const { data, width, height } = img;
  const lum = new Float32Array(width * height);
  for (let p = 0; p < width * height; p++) {
    const i = p * 4;
    lum[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }

  let edgeSum = 0;
  let weight = 0;
  const rowEnergy = new Float32Array(height);

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const p = y * width + x;
      if (mask[p] < 0.25) continue;
      const gx =
        -lum[p - width - 1] - 2 * lum[p - 1] - lum[p + width - 1] +
        lum[p - width + 1] + 2 * lum[p + 1] + lum[p + width + 1];
      const gy =
        -lum[p - width - 1] - 2 * lum[p - width] - lum[p - width + 1] +
        lum[p + width - 1] + 2 * lum[p + width] + lum[p + width + 1];
      const g = Math.hypot(gx, gy) / 1020;
      edgeSum += g * mask[p];
      rowEnergy[y] += g * mask[p];
      weight += mask[p];
    }
  }

  // Contraste: espalhamento de luminancia dentro do sujeito.
  const values: number[] = [];
  for (let p = 0; p < width * height; p++) if (mask[p] >= 0.35) values.push(lum[p]);
  values.sort((a, b) => a - b);
  const lo = values[Math.floor(values.length * 0.05)] ?? 0;
  const hi = values[Math.floor(values.length * 0.95)] ?? 0;

  // Barrado/listrado deixa a energia de borda oscilando linha a linha.
  let alternations = 0;
  const rowMean = mean(Array.from(rowEnergy));
  let above = rowEnergy[0] > rowMean;
  for (let y = 1; y < height; y++) {
    const now = rowEnergy[y] > rowMean;
    if (now !== above) alternations++;
    above = now;
  }

  return {
    edgeDensity: weight > 0 ? Math.min(1, (edgeSum / weight) * 6) : 0,
    contrast: Math.min(1, (hi - lo) / 200),
    banding: Math.min(1, alternations / (height * 0.35)),
  };
}

export function extractImageFeatures(input: RawImage): ImageFeatures {
  const img = downscale(input);
  const { mask, separability } = subjectMask(img);
  const palette = clusterColors(img, mask, 5);
  const { edgeDensity, contrast, banding } = edgeStats(img, mask);

  // Caixa do sujeito e faixas horizontais (cabeca -> ventre).
  let minX = img.width;
  let maxX = 0;
  let minY = img.height;
  let maxY = 0;
  let covered = 0;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (mask[y * img.width + x] < 0.35) continue;
      covered++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  const boxW = Math.max(1, maxX - minX + 1);
  const boxH = Math.max(1, maxY - minY + 1);

  const BAND_COUNT = 3;
  const bands: { hex: string; lab: Lab }[] = [];
  for (let bIdx = 0; bIdx < BAND_COUNT; bIdx++) {
    const y0 = minY + Math.floor((boxH * bIdx) / BAND_COUNT);
    const y1 = minY + Math.floor((boxH * (bIdx + 1)) / BAND_COUNT);
    let L = 0;
    let a = 0;
    let bb = 0;
    let w = 0;
    for (let y = y0; y < Math.max(y0 + 1, y1); y++) {
      for (let x = minX; x <= maxX; x++) {
        const p = y * img.width + x;
        const m = mask[p];
        if (m < 0.3) continue;
        const i = p * 4;
        const lab = rgbToLab(img.data[i], img.data[i + 1], img.data[i + 2]);
        L += lab.L * m;
        a += lab.a * m;
        bb += lab.b * m;
        w += m;
      }
    }
    const lab: Lab = w > 0 ? { L: L / w, a: a / w, b: bb / w } : { L: 50, a: 0, b: 0 };
    bands.push({ lab, hex: labToHex(lab) });
  }

  return {
    palette,
    bands,
    edgeDensity,
    contrast,
    aspectRatio: boxW / boxH,
    subjectShare: covered / (img.width * img.height),
    separability,
    banding,
  };
}
