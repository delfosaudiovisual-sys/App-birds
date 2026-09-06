/**
 * Gera o service worker depois do build do Vite.
 *
 * Escrito a mao em vez de usar um plugin porque o app tem uma exigencia
 * simples e rigida: precisa abrir 100% offline, no mato, sem sinal. O precache
 * lista TODOS os arquivos do build (os nomes ja vem com hash), entao a primeira
 * visita basta para o app inteiro ficar disponivel.
 */
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

const DIST = 'dist';

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(full)));
    else files.push(full);
  }
  return files;
}

const files = (await walk(DIST))
  .map((file) => `./${relative(DIST, file).split(sep).join('/')}`)
  .filter((file) => !file.endsWith('/sw.js'))
  // .map nao serve pra nada em runtime e so ocupa cache
  .filter((file) => !file.endsWith('.map'))
  .sort();

// A versao do cache muda quando qualquer arquivo muda, o que faz o SW antigo
// ser descartado sem precisar de numero de versao manual.
const hash = createHash('sha256');
for (const file of files) hash.update(file);
for (const file of files) hash.update(await readFile(join(DIST, file.slice(2))));
const version = hash.digest('hex').slice(0, 12);

const sw = `/* Gerado por scripts/build-sw.mjs — nao editar a mao. */
const CACHE = 'ornis-${version}';
const PRECACHE = ${JSON.stringify(files, null, 2)};

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      // Um unico arquivo indisponivel nao pode impedir a instalacao inteira:
      // melhor um app parcialmente cacheado do que nenhum.
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Navegacao: tenta a rede (para pegar deploy novo) e cai para o index
  // cacheado quando esta offline. Sem isso, abrir o app sem sinal da erro.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put('./index.html', copy));
          return response;
        })
        .catch(() => caches.match('./index.html').then((hit) => hit ?? Response.error())),
    );
    return;
  }

  // Demais recursos: cache primeiro. Os nomes vem com hash, entao o conteudo
  // em cache nunca fica velho para uma URL dada.
  event.respondWith(
    caches.match(request).then((hit) => {
      if (hit) return hit;
      return fetch(request).then((response) => {
        if (response.ok && response.type === 'basic') {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    }),
  );
});
`;

await writeFile(join(DIST, 'sw.js'), sw);
console.log(`sw.js gerado: ${files.length} arquivos no precache, versao ${version}`);
