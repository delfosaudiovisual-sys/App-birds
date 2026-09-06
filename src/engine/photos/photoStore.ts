import { getSpecies } from '../../data/species';
import { getStoredPhoto, putStoredPhoto, type StoredPhoto } from '../store/db';
import { fetchReferencePhoto, type Endpoints } from './wikimedia';

/**
 * Cache de fotos de referencia.
 *
 * Uma especie e buscada UMA vez na vida do aparelho. Depois disso a foto vem do
 * IndexedDB e o app volta a ser inteiramente offline. Tentativas que falham sao
 * lembradas por um tempo para o app nao insistir na rede a cada abertura da
 * ficha quando a especie simplesmente nao tem foto utilizavel.
 */

const failures = new Map<string, number>();
const RETRY_AFTER_MS = 6 * 60 * 60 * 1000;

const inFlight = new Map<string, Promise<StoredPhoto | null>>();

export interface PhotoOptions {
  endpoints?: Endpoints;
  signal?: AbortSignal;
}

export async function getReferencePhoto(
  speciesId: string,
  options: PhotoOptions = {},
): Promise<StoredPhoto | null> {
  try {
    const cached = await getStoredPhoto(speciesId);
    if (cached) return cached;
  } catch {
    // sem armazenamento local a busca ainda funciona, so nao persiste
  }

  const lastFailure = failures.get(speciesId);
  if (lastFailure && Date.now() - lastFailure < RETRY_AFTER_MS) return null;

  // Duas fichas abertas em sequencia nao devem disparar duas buscas iguais.
  const pending = inFlight.get(speciesId);
  if (pending) return pending;

  const species = getSpecies(speciesId);
  if (!species) return null;

  const promise = (async () => {
    try {
      const result = await fetchReferencePhoto(species.scientificName, {
        endpoints: options.endpoints,
        signal: options.signal,
      });
      if (!result) {
        failures.set(speciesId, Date.now());
        return null;
      }
      const stored: StoredPhoto = {
        speciesId,
        blob: result.blob,
        attribution: result.attribution,
        fetchedAt: Date.now(),
      };
      try {
        await putStoredPhoto(stored);
      } catch {
        // cota cheia ou modo privado: a foto vale para esta sessao mesmo assim
      }
      return stored;
    } catch {
      failures.set(speciesId, Date.now());
      return null;
    } finally {
      inFlight.delete(speciesId);
    }
  })();

  inFlight.set(speciesId, promise);
  return promise;
}

/** Esquece as falhas em memoria — usado quando a conexao volta. */
export function resetPhotoFailures(): void {
  failures.clear();
}
