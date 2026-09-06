import { defineConfig } from 'vitest/config';

/**
 * Bancada de precisao, separada do `npm test`.
 *
 * Estes arquivos sintetizam milhares de vocalizacoes e rodam a FFT em cima de
 * todas: levam minutos. Deixa-los no teste normal faria a verificacao rapida
 * deixar de ser rapida, e um teste que ninguem espera terminar nao e rodado.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.bench.ts'],
    testTimeout: 600_000,
    hookTimeout: 600_000,
  },
});
