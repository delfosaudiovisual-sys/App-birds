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

const DB_NAME = 'ornis';
const DB_VERSION = 1;
const STORE = 'sightings';

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
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('speciesId', 'speciesId', { unique: false });
        store.createIndex('timestamp', 'timestamp', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Falha ao abrir o banco local'));
  });
  return dbPromise;
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(STORE, mode);
        const request = run(transaction.objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('Falha na operacao local'));
      }),
  );
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
      });
      continue;
    }
    current.count += 1;
    current.firstSeen = Math.min(current.firstSeen, s.timestamp);
    current.lastSeen = Math.max(current.lastSeen, s.timestamp);
    current.bestConfidence = Math.max(current.bestConfidence, s.confidence);
    if (s.songType && !current.songTypes.includes(s.songType)) current.songTypes.push(s.songType);
    if (s.kind === 'foto') current.hasPhoto = true;
    if (s.kind === 'canto') current.hasAudio = true;
  }
  return map;
}
