import { listSightings, saveSighting, type Sighting } from './db';

/**
 * Exportacao e importacao da pokedex.
 *
 * Existe por causa de uma armadilha real do iPhone: o Safari apaga os dados de
 * um site que passa sete dias sem ser aberto. Uma colecao construida ao longo
 * de meses pode sumir depois de uma semana de ferias. `navigator.storage
 * .persist()` reduz o risco, mas nao e garantia — um arquivo de backup e.
 *
 * O audio original fica DE FORA: cada gravacao pesa centenas de kilobytes e um
 * backup com cinquenta registros passaria de vinte megabytes, grande demais
 * para o usuario mandar por e-mail ou guardar no iCloud com tranquilidade. O
 * que importa para a colecao — especie, data, tipo de canto, medidas, miniatura
 * e localizacao — cabe folgado.
 */

export const BACKUP_VERSION = 1;

export interface BackupFile {
  format: 'ornis-pokedex';
  version: number;
  exportedAt: string;
  /** registros sem o audio bruto */
  sightings: Omit<Sighting, 'audio'>[];
}

export async function exportBackup(): Promise<BackupFile> {
  const sightings = await listSightings();
  return {
    format: 'ornis-pokedex',
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    sightings: sightings.map(({ audio: _audio, ...rest }) => rest),
  };
}

export function backupFileName(): string {
  const now = new Date();
  const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return `pokedex-ornis-${stamp}.json`;
}

/** Dispara o download do backup. */
export async function downloadBackup(): Promise<number> {
  const backup = await exportBackup();
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = backupFileName();
  document.body.appendChild(link);
  link.click();
  link.remove();
  // A revogacao imediata cancela o download em alguns navegadores.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return backup.sightings.length;
}

export interface ImportResult {
  imported: number;
  skipped: number;
}

function isSighting(value: unknown): value is Sighting {
  const s = value as Partial<Sighting> | null;
  return (
    !!s &&
    typeof s.id === 'string' &&
    typeof s.speciesId === 'string' &&
    (s.kind === 'canto' || s.kind === 'foto') &&
    typeof s.timestamp === 'number' &&
    typeof s.confidence === 'number'
  );
}

/**
 * Importa um backup, somando ao que ja existe.
 *
 * A juncao e por id: reimportar o mesmo arquivo nao duplica registros, e
 * importar o backup de outro aparelho junta as duas colecoes.
 */
export async function importBackup(text: string): Promise<ImportResult> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Arquivo invalido: nao e um JSON.');
  }

  const file = parsed as Partial<BackupFile>;
  if (file.format !== 'ornis-pokedex' || !Array.isArray(file.sightings)) {
    throw new Error('Este arquivo nao e um backup da pokedex.');
  }
  if (typeof file.version === 'number' && file.version > BACKUP_VERSION) {
    throw new Error('Backup criado por uma versao mais nova do app.');
  }

  let imported = 0;
  let skipped = 0;
  for (const entry of file.sightings) {
    if (!isSighting(entry)) {
      skipped++;
      continue;
    }
    // `alternatives` ausente em backups antigos nao pode quebrar a leitura
    await saveSighting({ ...entry, alternatives: entry.alternatives ?? [] });
    imported++;
  }
  return { imported, skipped };
}
