import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Build de arquivo unico.
 *
 * Diferencas em relacao ao build normal, todas necessarias para caber num
 * arquivo so: nada de divisao em pedacos (`inlineDynamicImports`), e todo
 * asset vira data URI em vez de arquivo separado.
 *
 * O custo e o pacote maior — o SDK usado pela identificacao assistida, que no
 * build normal so e baixado por quem liga o recurso, aqui entra sempre.
 */
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist-single',
    target: 'es2022',
    sourcemap: false,
    cssCodeSplit: false,
    assetsInlineLimit: 100_000_000,
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
        entryFileNames: 'app.js',
        assetFileNames: 'app.[ext]',
      },
    },
  },
});
