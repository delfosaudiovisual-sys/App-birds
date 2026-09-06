import type { Environment } from '../../data/occurrence';

export interface Settings {
  /** ambiente onde o usuario costuma gravar; pre-seleciona a pista de campo */
  defaultEnvironment?: Environment;
  /** usa a CNN local (MobileNet via CDN) para reforcar a identificacao por foto */
  useLocalCnn: boolean;
  /** endpoint e chave de um modelo em nuvem para identificacao assistida */
  cloudEnabled: boolean;
  cloudApiKey: string;
  /** grava a localizacao junto com o registro */
  saveLocation: boolean;
  /** guarda o audio original (ocupa mais espaco) */
  keepAudio: boolean;
  /** duracao alvo da gravacao, em segundos */
  recordSeconds: number;
  /** aumenta o tamanho da fonte e dos alvos de toque */
  largeText: boolean;
  /** reduz animacoes */
  reduceMotion: boolean;
}

const KEY = 'ornis:settings:v1';

export const DEFAULT_SETTINGS: Settings = {
  defaultEnvironment: undefined,
  useLocalCnn: false,
  cloudEnabled: false,
  cloudApiKey: '',
  saveLocation: true,
  keepAudio: true,
  recordSeconds: 8,
  largeText: false,
  reduceMotion: false,
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // modo privado ou armazenamento cheio: seguir sem persistir
  }
}
