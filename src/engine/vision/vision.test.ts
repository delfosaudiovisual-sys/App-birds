import { describe, expect, it } from 'vitest';
import { rgbToLab, hexToRgb, deltaE, colorSimilarity } from './color';
import { extractImageFeatures, type RawImage } from './imageFeatures';
import { matchPhoto } from './photoMatcher';

/** Cria uma imagem com fundo uniforme e um "passaro" retangular no centro. */
function makeImage(opts: {
  width?: number;
  height?: number;
  background: [number, number, number];
  subject: { color: [number, number, number]; x0: number; y0: number; x1: number; y1: number }[];
  stripes?: { period: number; color: [number, number, number] };
}): RawImage {
  const width = opts.width ?? 120;
  const height = opts.height ?? 120;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      let [r, g, b] = opts.background;
      for (const s of opts.subject) {
        if (x >= s.x0 && x <= s.x1 && y >= s.y0 && y <= s.y1) [r, g, b] = s.color;
      }
      if (opts.stripes) {
        const inSubject = opts.subject.some((s) => x >= s.x0 && x <= s.x1 && y >= s.y0 && y <= s.y1);
        if (inSubject && Math.floor(y / opts.stripes.period) % 2 === 0) [r, g, b] = opts.stripes.color;
      }
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }
  return { data, width, height };
}

describe('conversao de cor', () => {
  it('converte branco e preto de referencia', () => {
    const white = rgbToLab(255, 255, 255);
    expect(white.L).toBeCloseTo(100, 0);
    expect(Math.abs(white.a)).toBeLessThan(1);
    const black = rgbToLab(0, 0, 0);
    expect(black.L).toBeCloseTo(0, 1);
  });

  it('le hex de 3 e de 6 digitos', () => {
    expect(hexToRgb('#fff')).toEqual([255, 255, 255]);
    expect(hexToRgb('#ff8800')).toEqual([255, 136, 0]);
  });

  it('mede distancia perceptual coerente', () => {
    const amareloA = rgbToLab(242, 201, 44);
    const amareloB = rgbToLab(240, 205, 60);
    const azul = rgbToLab(31, 111, 196);
    expect(deltaE(amareloA, amareloB)).toBeLessThan(deltaE(amareloA, azul));
    expect(colorSimilarity(amareloA, amareloB)).toBeGreaterThan(0.8);
    expect(colorSimilarity(amareloA, azul)).toBeLessThan(0.3);
  });
});

describe('extracao de features da imagem', () => {
  it('isola a cor do sujeito e ignora o fundo', () => {
    const img = makeImage({
      background: [140, 190, 240], // ceu
      subject: [{ color: [242, 201, 44], x0: 35, y0: 35, x1: 85, y1: 85 }], // ave amarela
    });
    const f = extractImageFeatures(img);
    expect(f.palette.length).toBeGreaterThan(0);
    const dominant = f.palette[0];
    // a cor dominante do sujeito precisa ser amarela, nao azul de ceu
    expect(dominant.lab.b).toBeGreaterThan(30);
    expect(f.separability).toBeGreaterThan(0.3);
    expect(f.subjectShare).toBeGreaterThan(0.05);
  });

  it('mede mais textura numa plumagem barrada que numa lisa', () => {
    const plain = extractImageFeatures(
      makeImage({
        background: [120, 130, 120],
        subject: [{ color: [230, 230, 225], x0: 30, y0: 30, x1: 90, y1: 90 }],
      }),
    );
    const barred = extractImageFeatures(
      makeImage({
        background: [120, 130, 120],
        subject: [{ color: [230, 230, 225], x0: 30, y0: 30, x1: 90, y1: 90 }],
        stripes: { period: 3, color: [20, 20, 25] },
      }),
    );
    expect(barred.edgeDensity).toBeGreaterThan(plain.edgeDensity);
    expect(barred.banding).toBeGreaterThan(plain.banding);
    expect(barred.contrast).toBeGreaterThan(plain.contrast);
  });

  it('mede a proporcao do recorte do sujeito', () => {
    const wide = extractImageFeatures(
      makeImage({
        background: [90, 100, 90],
        subject: [{ color: [220, 60, 40], x0: 15, y0: 45, x1: 105, y1: 75 }],
      }),
    );
    expect(wide.aspectRatio).toBeGreaterThan(1.5);
  });

  it('separa cabeca, corpo e ventre em faixas', () => {
    const f = extractImageFeatures(
      makeImage({
        background: [140, 190, 240],
        subject: [
          { color: [25, 25, 25], x0: 40, y0: 30, x1: 80, y1: 50 }, // cabeca preta
          { color: [242, 201, 44], x0: 40, y0: 51, x1: 80, y1: 90 }, // ventre amarelo
        ],
      }),
    );
    expect(f.bands).toHaveLength(3);
    // topo escuro, base clara e amarela
    expect(f.bands[0].lab.L).toBeLessThan(f.bands[2].lab.L);
    expect(f.bands[2].lab.b).toBeGreaterThan(f.bands[0].lab.b);
  });
});

describe('identificacao por foto', () => {
  it('devolve probabilidades normalizadas e ordenadas', () => {
    const f = extractImageFeatures(
      makeImage({
        background: [140, 190, 240],
        subject: [{ color: [242, 201, 44], x0: 35, y0: 35, x1: 85, y1: 85 }],
      }),
    );
    const result = matchPhoto(f);
    expect(result.matches).toHaveLength(5);
    expect(result.matches.reduce((a, m) => a + m.probability, 0)).toBeCloseTo(1, 5);
    for (let i = 1; i < result.matches.length; i++) {
      expect(result.matches[i - 1].fit).toBeGreaterThanOrEqual(result.matches[i].fit);
    }
  });

  it('coloca uma ave amarela acima de uma ave azul-escura', () => {
    const f = extractImageFeatures(
      makeImage({
        background: [120, 140, 120],
        subject: [{ color: [242, 196, 20], x0: 35, y0: 30, x1: 85, y1: 90 }],
      }),
    );
    const all = matchPhoto(f, { topN: 60 }).matches;
    const canario = all.findIndex((m) => m.species.id === 'canario-da-terra');
    const azulao = all.findIndex((m) => m.species.id === 'azulao');
    expect(canario).toBeGreaterThanOrEqual(0);
    expect(canario).toBeLessThan(azulao);
  });

  it('coloca uma ave vermelha de asas pretas acima de uma ave verde', () => {
    const f = extractImageFeatures(
      makeImage({
        background: [200, 210, 200],
        subject: [
          { color: [196, 23, 42], x0: 35, y0: 30, x1: 85, y1: 70 },
          { color: [26, 23, 24], x0: 35, y0: 71, x1: 85, y1: 92 },
        ],
      }),
    );
    const all = matchPhoto(f, { topN: 60 }).matches;
    const tie = all.findIndex((m) => m.species.id === 'tie-sangue');
    const periquitao = all.findIndex((m) => m.species.id === 'periquitao-maracana');
    expect(tie).toBeLessThan(periquitao);
  });

  it('avisa quando o sujeito nao se destaca do fundo', () => {
    const f = extractImageFeatures(
      makeImage({
        background: [128, 128, 128],
        subject: [{ color: [131, 130, 129], x0: 40, y0: 40, x1: 80, y1: 80 }],
      }),
    );
    const result = matchPhoto(f);
    expect(result.inconclusive).toBe(true);
    expect(result.notes.length).toBeGreaterThan(0);
  });

  it('aceita reforco de um classificador externo sem deixar ele decidir sozinho', () => {
    const f = extractImageFeatures(
      makeImage({
        background: [140, 190, 240],
        subject: [{ color: [242, 201, 44], x0: 35, y0: 35, x1: 85, y1: 85 }],
      }),
    );
    const plain = matchPhoto(f, { topN: 60 });
    const boosted = matchPhoto(f, {
      topN: 60,
      boost: { byFamily: { Ramphastidae: 1 }, source: 'teste' },
    });
    const idx = (r: typeof plain, id: string) => r.matches.findIndex((m) => m.species.id === id);
    expect(idx(boosted, 'tucano-toco')).toBeLessThanOrEqual(idx(plain, 'tucano-toco'));
    expect(boosted.assistedBy).toBe('teste');
    // o reforco nao pode inverter uma paleta obviamente incompativel
    expect(boosted.matches[0].species.family).not.toBe('Ramphastidae');
  });
});
