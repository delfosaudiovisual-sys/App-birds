/** Conversoes de cor. Toda comparacao de plumagem acontece em CIELAB, porque
 *  distancia euclidiana em RGB nao corresponde a diferenca que o olho ve:
 *  em RGB, dois verdes distintos podem ficar mais "perto" que um verde e um
 *  cinza obviamente diferentes. */

export interface Lab {
  L: number;
  a: number;
  b: number;
}

export function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

export function rgbToHex(r: number, g: number, b: number): string {
  const to = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

function pivotRgb(v: number): number {
  const c = v / 255;
  return c > 0.04045 ? ((c + 0.055) / 1.055) ** 2.4 : c / 12.92;
}

function pivotXyz(v: number): number {
  return v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116;
}

export function rgbToLab(r: number, g: number, b: number): Lab {
  const R = pivotRgb(r);
  const G = pivotRgb(g);
  const B = pivotRgb(b);

  // sRGB -> XYZ (D65)
  const x = (R * 0.4124564 + G * 0.3575761 + B * 0.1804375) / 0.95047;
  const y = R * 0.2126729 + G * 0.7151522 + B * 0.072175;
  const z = (R * 0.0193339 + G * 0.119192 + B * 0.9503041) / 1.08883;

  const fx = pivotXyz(x);
  const fy = pivotXyz(y);
  const fz = pivotXyz(z);

  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

export function hexToLab(hex: string): Lab {
  const [r, g, b] = hexToRgb(hex);
  return rgbToLab(r, g, b);
}

/** Delta E CIE76: suficiente para agrupar manchas de plumagem. */
export function deltaE(a: Lab, b: Lab): number {
  return Math.hypot(a.L - b.L, a.a - b.a, a.b - b.b);
}

/** 0-1, onde 1 e cor identica. ~30 de deltaE ja e "cor claramente outra". */
export function colorSimilarity(a: Lab, b: Lab): number {
  return Math.max(0, 1 - deltaE(a, b) / 60);
}
