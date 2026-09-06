/**
 * Junta o build de arquivo unico num `ornis.html` autossuficiente.
 *
 * Serve para levar o app a um aparelho sem publicar nada. Vale registrar o
 * limite: aberto de `file://`, o Safari nao considera a pagina um contexto
 * seguro, entao o MICROFONE nao funciona e o IndexedDB e bloqueado. Para o app
 * inteiro — gravar canto e guardar a pokedex — e preciso servir por https.
 */
import { readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const DIR = 'dist-single';

const html = await readFile(join(DIR, 'index.html'), 'utf8');
const js = await readFile(join(DIR, 'app.js'), 'utf8');
const css = await readFile(join(DIR, 'app.css'), 'utf8');
const iconSvg = await readFile('public/icons/icon.svg', 'utf8');
const iconPng = await readFile('public/icons/icon-192.png');

const svgDataUri = `data:image/svg+xml;base64,${Buffer.from(iconSvg).toString('base64')}`;
const pngDataUri = `data:image/png;base64,${iconPng.toString('base64')}`;

/** Escapa `</script>` dentro do codigo, que encerraria a tag mais cedo. */
const safeJs = js.replace(/<\/script>/gi, '<\\/script>');

// As substituicoes usam FUNCAO, nao string. Com string, `replace` interpreta
// `$&`, `$'` e `$1` como referencias ao trecho casado — e codigo JavaScript
// minificado tem essas sequencias em abundancia, o que reinjetava a propria tag
// <script src> dentro do bundle e quebrava o arquivo inteiro.
let out = html
  .replace(/<script[^>]*src="[^"]*app\.js"[^>]*><\/script>/, () => `<script type="module">${safeJs}</script>`)
  .replace(/<link[^>]*rel="stylesheet"[^>]*href="[^"]*app\.css"[^>]*>/, () => `<style>${css}</style>`)
  .replace(/<link[^>]*rel="manifest"[^>]*>/, () => '')
  .replace(/href="\.\/icons\/icon\.svg"/g, () => `href="${svgDataUri}"`)
  .replace(/href="\.\/icons\/icon-192\.png"/g, () => `href="${pngDataUri}"`)
  .replace(/<link[^>]*rel="modulepreload"[^>]*>/g, () => '');

// Aviso visivel enquanto o app carrega, para quem abrir o arquivo direto.
out = out.replace(
  '<div id="root"></div>',
  () => `<div id="root"></div>
    <script>
      // Se a pagina nao esta num contexto seguro, o microfone nunca vai
      // funcionar aqui — melhor dizer isso na cara do que deixar o botao de
      // gravar falhar sem explicacao.
      if (!window.isSecureContext) {
        window.addEventListener('DOMContentLoaded', function () {
          var bar = document.createElement('div');
          bar.setAttribute('role', 'status');
          bar.style.cssText =
            'position:fixed;left:0;right:0;top:0;z-index:9999;padding:10px 14px;' +
            'background:#3b2c12;color:#f0d79a;font:13px/1.4 system-ui,sans-serif;' +
            'border-bottom:1px solid #6b5320';
          bar.textContent =
            'Arquivo aberto direto do aparelho: o navegador bloqueia o microfone e o armazenamento. ' +
            'A pokedex e a identificacao por foto funcionam; para gravar canto, abra o app por https.';
          document.body.appendChild(bar);
          document.body.style.paddingTop = bar.offsetHeight + 'px';
        });
      }
    </script>`,
);

await writeFile('ornis.html', out);

for (const entry of await readdir(DIR)) await rm(join(DIR, entry), { recursive: true, force: true });
await rm(DIR, { recursive: true, force: true });

const kb = (Buffer.byteLength(out) / 1024).toFixed(0);
console.log(`ornis.html gerado: ${kb} KB, sem nenhuma dependencia externa`);
