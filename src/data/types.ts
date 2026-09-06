import type { SongTypePrior } from '../engine/audio/songType';

export type Range = [number, number];

export type RhythmClass =
  | 'frase'
  | 'trinado'
  | 'nota-isolada'
  | 'serie-regular'
  | 'serie-acelerada'
  | 'irregular';

export interface AcousticProfile {
  /** faixa tipica da frequencia dominante, Hz */
  peakHz: Range;
  /** extremos ocupados pelo canto, Hz */
  bandHz: Range;
  /** notas por segundo */
  noteRate: Range;
  /** duracao de uma nota, s */
  noteDurationSec: Range;
  /** duracao de uma frase completa, s */
  phraseSec: Range;
  /** 0 = aspero/ruidoso, 1 = assobio puro */
  tonality: Range;
  /** 0-1, modulacao de frequencia dentro da nota */
  fmDepth: Range;
  rhythm: RhythmClass;
  /**
   * Motivo melodico: contorno de altura normalizado 0-1 no tempo.
   * Serve para o alinhamento (DTW) que separa especies com features parecidas.
   */
  motif?: number[];
  /** notas tipicas por frase */
  notesPerPhrase?: Range;
}

export type PlumageRegion = 'cabeca' | 'peito' | 'dorso' | 'asa' | 'cauda' | 'bico' | 'ventre';

export interface VisualProfile {
  palette: { hex: string; share: number; region: PlumageRegion }[];
  pattern: 'uniforme' | 'listrado' | 'barrado' | 'manchado' | 'capuz' | 'mascarado' | 'bicolor';
  billShape: 'conico' | 'fino' | 'fino-curvo' | 'ganchudo' | 'longo-reto' | 'largo' | 'gigante';
  silhouette:
    | 'passeriforme'
    | 'rapinante'
    | 'aquatica'
    | 'pernalta'
    | 'columbiforme'
    | 'psitacideo'
    | 'beija-flor'
    | 'tucano'
    | 'coruja'
    | 'terrestre';
  /** 0-1, contraste interno da plumagem */
  contrast: number;
}

export type Conservation = 'LC' | 'NT' | 'VU' | 'EN' | 'CR' | 'DD';

export interface Species {
  id: string;
  commonName: string;
  altNames?: string[];
  scientificName: string;
  family: string;
  /** comprimento total, cm */
  sizeCm: Range;
  habitat: string[];
  diet: string[];
  distribution: string;
  /** descricao de campo da aparencia */
  description: string;
  behavior: string;
  songDescription: string;
  funFact: string;
  conservation: Conservation;
  /** 1 = muito comum, 5 = dificil de encontrar (sabor pokedex) */
  rarity: 1 | 2 | 3 | 4 | 5;
  acoustic: AcousticProfile;
  visual: VisualProfile;
  songTypePrior?: SongTypePrior;
}
