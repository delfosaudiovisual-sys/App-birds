import type { RawImage } from './imageFeatures';

export interface LoadedImage {
  raw: RawImage;
  /** miniatura em JPEG (data URL) para guardar na pokedex */
  thumbnail: string;
  width: number;
  height: number;
}

const ANALYSIS_MAX = 512;
const THUMB_MAX = 480;

function drawToCanvas(source: CanvasImageSource, w: number, h: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas indisponivel neste navegador.');
  ctx.drawImage(source, 0, 0, w, h);
  return canvas;
}

/** Le um arquivo de imagem e devolve pixels para analise mais a miniatura. */
export async function loadImageFile(file: Blob): Promise<LoadedImage> {
  const bitmap = await createBitmap(file);
  const { width, height } = bitmap;

  const scale = Math.min(1, ANALYSIS_MAX / Math.max(width, height));
  const aw = Math.max(1, Math.round(width * scale));
  const ah = Math.max(1, Math.round(height * scale));
  const analysisCanvas = drawToCanvas(bitmap.source, aw, ah);
  const ctx = analysisCanvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas indisponivel neste navegador.');
  const imageData = ctx.getImageData(0, 0, aw, ah);

  const tScale = Math.min(1, THUMB_MAX / Math.max(width, height));
  const thumbCanvas = drawToCanvas(
    bitmap.source,
    Math.max(1, Math.round(width * tScale)),
    Math.max(1, Math.round(height * tScale)),
  );

  bitmap.release();

  return {
    raw: { data: imageData.data, width: aw, height: ah },
    thumbnail: thumbCanvas.toDataURL('image/jpeg', 0.82),
    width,
    height,
  };
}

interface Bitmap {
  source: CanvasImageSource;
  width: number;
  height: number;
  release: () => void;
}

async function createBitmap(file: Blob): Promise<Bitmap> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(file);
      return { source: bmp, width: bmp.width, height: bmp.height, release: () => bmp.close() };
    } catch {
      // Safari antigo pode falhar com alguns HEIC/JPEG: cai no caminho do <img>
    }
  }
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.decoding = 'async';
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('Nao foi possivel abrir esta imagem.'));
    img.src = url;
  });
  return {
    source: img,
    width: img.naturalWidth,
    height: img.naturalHeight,
    release: () => URL.revokeObjectURL(url),
  };
}
