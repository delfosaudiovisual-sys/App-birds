import type { SongTypeId } from '../audio/songType';

export interface Sighting {
  id: string;
  speciesId: string;
  kind: 'canto' | 'foto';
  /** epoch ms */
  timestamp: number;
  /** 0-1 */
  confidence: number;
  /** 0-1, probabilidade do topo entre os candidatos */
  probability: number;
  /** alternativas consideradas, para o usuario poder corrigir */
  alternatives: { speciesId: string; probability: number }[];
  songType?: SongTypeId;
  songTypeProbabilities?: Record<SongTypeId, number>;
  songTypeConfidence?: number;
  /** resumo numerico do que foi medido, exibido na ficha */
  metrics?: Record<string, number>;
  /** PNG do espectrograma ou miniatura da foto, como data URL */
  thumbnail?: string;
  /** audio original (webm/mp4) para reouvir */
  audio?: Blob;
  location?: { lat: number; lon: number; accuracy: number };
  /** true quando o usuario confirmou/corrigiu manualmente a especie */
  verified?: boolean;
  note?: string;
}

import type { PhotoAttribution } from '../photos/wikimedia';

const DB_NAME = 'ornis';
/** v2 acrescentou o armazem de fotos de referencia */
const DB_VERSION = 2;
const STORE = 'sightings';
const PHOTO_STORE = 'photos';

export interface StoredPhoto {
  speciesId: string;
  blob: Blob;
  attribution: PhotoAttribution;
  fetchedAt: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB indisponivel neste navegador'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      // Cada armazem e criado so se faltar: quem ja tem a base na v1 recebe
      // apenas o armazem novo, sem perder um registro sequer da pokedex.
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('speciesId', 'speciesId', { unique: false });
        store.createIndex('timestamp', 'timestamp', { unique: false });
      }
      if (!db.objectStoreNames.contains(PHOTO_STORE)) {
        db.createObjectStore(PHOTO_STORE, { keyPath: 'speciesId' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Falha ao abrir o banco local'));
  });
  return dbPromise;
}

function tx<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
  storeName: string = STORE,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(storeName, mode);
        const request = run(transaction.objectStore(storeName));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('Falha na operacao local'));
      }),
  );
}

export async function getStoredPhoto(speciesId: string): Promise<StoredPhoto | undefined> {
  return tx<StoredPhoto | undefined>(
    'readonly',
    (store) => store.get(speciesId) as IDBRequest<StoredPhoto | undefined>,
    PHOTO_STORE,
  );
}

export async function putStoredPhoto(photo: StoredPhoto): Promise<void> {
  await tx('readwrite', (store) => store.put(photo), PHOTO_STORE);
}

export async function listStoredPhotos(): Promise<StoredPhoto[]> {
  return tx<StoredPhoto[]>('readonly', (store) => store.getAll() as IDBRequest<StoredPhoto[]>, PHOTO_STORE);
}

export async function clearStoredPhotos(): Promise<void> {
  await tx('readwrite', (store) => store.clear(), PHOTO_STORE);
}

export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function saveSighting(sighting: Sighting): Promise<void> {
  await tx('readwrite', (store) => store.put(sighting));
}

export async function deleteSighting(id: string): Promise<void> {
  await tx('readwrite', (store) => store.delete(id));
}

export async function listSightings(): Promise<Sighting[]> {
  const all = await tx<Sighting[]>('readonly', (store) => store.getAll() as IDBRequest<Sighting[]>);
  return all.sort((a, b) => b.timestamp - a.timestamp);
}

export async function clearAll(): Promise<void> {
  await tx('readwrite', (store) => store.clear());
}

export interface SpeciesProgress {
  speciesId: string;
  count: number;
  firstSeen: number;
  lastSeen: number;
  bestConfidence: number;
  /** tipos de canto ja registrados para esta especie */
  songTypes: SongTypeId[];
  hasPhoto: boolean;
  hasAudio: boolean;
  /** melhor foto propria do usuario para esta especie, como data URL */
  userPhoto?: string;
  /** confianca do registro que originou userPhoto, para escolher a melhor */
  userPhotoConfidence?: number;
}

/** Agrega os registros por especie: e o "estado da pokedex". */
export function buildProgress(sightings: Sighting[]): Map<string, SpeciesProgress> {
  const map = new Map<string, SpeciesProgress>();
  for (const s of sightings) {
    const current = map.get(s.speciesId);
    if (!current) {
      map.set(s.speciesId, {
        speciesId: s.speciesId,
        count: 1,
        firstSeen: s.timestamp,
        lastSeen: s.timestamp,
        bestConfidence: s.confidence,
        songTypes: s.songType ? [s.songType] : [],
        hasPhoto: s.kind === 'foto',
        hasAudio: s.kind === 'canto',
        userPhoto: s.kind === 'foto' ? s.thumbnail : undefined,
        userPhotoConfidence: s.kind === 'foto' ? s.confidence : undefined,
      });
      continue;
    }
    current.count += 1;
    current.firstSeen = Math.min(current.firstSeen, s.timestamp);
    current.lastSeen = Math.max(current.lastSeen, s.timestamp);
    current.bestConfidence = Math.max(current.bestConfidence, s.confidence);
    if (s.songType && !current.songTypes.includes(s.songType)) current.songTypes.push(s.songType);
    if (s.kind === 'foto') {
      current.hasPhoto = true;
      // entre varias fotos da mesma especie, fica a do registro mais confiavel
      if (s.thumbnail && s.confidence > (current.userPhotoConfidence ?? -1)) {
        current.userPhoto = s.thumbnail;
        current.userPhotoConfidence = s.confidence;
      }
    }
    if (s.kind === 'canto') current.hasAudio = true;
  }
  return map;
}
