import { describe, expect, it } from 'vitest';
import { importBackup, BACKUP_VERSION } from './backup';

/**
 * Os caminhos de rejeicao sao o que importa testar aqui: um backup mal lido
 * silenciosamente sobrescreveria a colecao do usuario.
 */
describe('importacao de backup', () => {
  it('recusa texto que nao e JSON', async () => {
    await expect(importBackup('nao sou json')).rejects.toThrow(/nao e um JSON/);
  });

  it('recusa JSON que nao e backup da pokedex', async () => {
    await expect(importBackup('{"format":"outra-coisa"}')).rejects.toThrow(/nao e um backup/);
    await expect(importBackup('{"format":"ornis-pokedex"}')).rejects.toThrow(/nao e um backup/);
  });

  it('recusa backup de uma versao futura', async () => {
    const payload = JSON.stringify({
      format: 'ornis-pokedex',
      version: BACKUP_VERSION + 1,
      sightings: [],
    });
    await expect(importBackup(payload)).rejects.toThrow(/versao mais nova/);
  });
});
