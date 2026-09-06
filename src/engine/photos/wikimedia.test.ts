import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fetchReferencePhoto, stripHtml, type Endpoints } from './wikimedia';

/**
 * Testes contra um servidor local que replica o FORMATO das respostas reais da
 * Action API do MediaWiki.
 *
 * Aviso honesto: os endpoints reais da Wikimedia estao bloqueados pela politica
 * de rede do ambiente onde este codigo foi escrito, entao a chamada ao servico
 * real nao foi exercitada aqui. O que estes testes cobrem e tudo o que pode
 * quebrar do lado do app — montagem da URL, leitura das duas respostas,
 * extracao de autor e licenca, limpeza do HTML, e cada caminho de falha. Vale
 * conferir uma vez no aparelho que a busca ao vivo funciona.
 */

/** Um PNG 1x1 valido, para o servidor devolver uma imagem de verdade. */
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

interface Scenario {
  wikipedia?: unknown;
  wikipediaEn?: unknown;
  commons?: unknown;
  imageStatus?: number;
  imageType?: string;
}

let server: Server;
let base = '';
let scenario: Scenario = {};
const requests: string[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    requests.push(url.pathname + url.search);

    if (url.pathname === '/imagem.png') {
      res.writeHead(scenario.imageStatus ?? 200, { 'Content-Type': scenario.imageType ?? 'image/png' });
      res.end(PNG_1PX);
      return;
    }

    const payload =
      url.pathname === '/pt' ? scenario.wikipedia : url.pathname === '/en' ? scenario.wikipediaEn : scenario.commons;

    if (payload === undefined) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end('{}');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload));
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function endpoints(): Endpoints {
  return { wikipedia: (lang) => `${base}/${lang}`, commons: `${base}/commons` };
}

/** Formato real de uma resposta de `prop=pageimages`. */
function pageImagesResponse(fileName: string) {
  return {
    batchcomplete: '',
    query: {
      pages: {
        '12345': {
          pageid: 12345,
          ns: 0,
          title: 'Turdus rufiventris',
          thumbnail: { source: `${base}/imagem.png`, width: 640, height: 480 },
          pageimage: fileName,
        },
      },
    },
  };
}

/** Formato real de uma resposta de `prop=imageinfo&iiprop=extmetadata`. */
function commonsResponse(overrides: Record<string, unknown> = {}) {
  return {
    query: {
      pages: {
        '-1': {
          ns: 6,
          title: 'File:Turdus rufiventris.jpg',
          imageinfo: [
            {
              thumburl: `${base}/imagem.png`,
              url: `${base}/imagem.png`,
              descriptionurl: 'https://commons.wikimedia.org/wiki/File:Turdus_rufiventris.jpg',
              extmetadata: {
                Artist: { value: '<a href="//commons.wikimedia.org/wiki/User:Ana">Ana &amp; Jo&#039;s</a>' },
                LicenseShortName: { value: 'CC BY-SA 4.0' },
                LicenseUrl: { value: 'https://creativecommons.org/licenses/by-sa/4.0' },
                ...overrides,
              },
            },
          ],
        },
      },
    },
  };
}

describe('limpeza de HTML do credito', () => {
  it('remove marcacao e resolve entidades', () => {
    expect(stripHtml('<a href="#">Ana &amp; Jo&#039;s</a>')).toBe("Ana & Jo's");
    expect(stripHtml('<span>  varios   espacos </span>')).toBe('varios espacos');
    expect(stripHtml('')).toBe('');
  });
});

describe('busca de foto de referencia', () => {
  it('resolve foto, autor e licenca a partir das duas respostas', async () => {
    scenario = { wikipedia: pageImagesResponse('Turdus rufiventris.jpg'), commons: commonsResponse() };
    const photo = await fetchReferencePhoto('Turdus rufiventris', { endpoints: endpoints() });

    expect(photo).not.toBeNull();
    expect(photo!.attribution.author).toBe("Ana & Jo's");
    expect(photo!.attribution.license).toBe('CC BY-SA 4.0');
    expect(photo!.attribution.licenseUrl).toContain('creativecommons.org');
    expect(photo!.attribution.sourceUrl).toContain('commons.wikimedia.org');
    expect(photo!.attribution.title).toBe('Turdus rufiventris.jpg');
    expect(photo!.blob.type).toBe('image/png');
    expect(photo!.blob.size).toBeGreaterThan(0);
  });

  it('monta a consulta com CORS anonimo e o nome cientifico', async () => {
    requests.length = 0;
    scenario = { wikipedia: pageImagesResponse('a.jpg'), commons: commonsResponse() };
    await fetchReferencePhoto('Pitangus sulphuratus', { endpoints: endpoints() });

    const wiki = requests.find((r) => r.startsWith('/pt'))!;
    expect(wiki).toContain('action=query');
    expect(wiki).toContain('prop=pageimages');
    // `*` nao e percent-encoded por URLSearchParams, e o MediaWiki espera o
    // asterisco literal para liberar CORS anonimo.
    expect(wiki).toContain('origin=*');
    expect(wiki).toContain('redirects=1');
    expect(decodeURIComponent(wiki.replace(/\+/g, ' '))).toContain('titles=Pitangus sulphuratus');

    const commons = requests.find((r) => r.startsWith('/commons'))!;
    expect(commons).toContain('prop=imageinfo');
    expect(commons).toContain('extmetadata');
    expect(commons).toContain('origin=*');
  });

  it('cai para o ingles quando o artigo em portugues nao existe', async () => {
    requests.length = 0;
    scenario = {
      wikipedia: { batchcomplete: '', query: { pages: { '-1': { ns: 0, title: 'X', missing: '' } } } },
      wikipediaEn: pageImagesResponse('En.jpg'),
      commons: commonsResponse(),
    };
    const photo = await fetchReferencePhoto('Cyphorhinus arada', { endpoints: endpoints() });
    expect(photo).not.toBeNull();
    expect(requests.some((r) => r.startsWith('/en'))).toBe(true);
  });

  it('devolve null quando nenhum idioma tem imagem', async () => {
    scenario = {
      wikipedia: { query: { pages: { '-1': { missing: '' } } } },
      wikipediaEn: { query: { pages: { '-1': { missing: '' } } } },
    };
    expect(await fetchReferencePhoto('Especie inexistente', { endpoints: endpoints() })).toBeNull();
  });

  it('recusa a foto quando o Commons nao informa credito', async () => {
    scenario = { wikipedia: pageImagesResponse('SemCredito.jpg'), commons: { query: { pages: {} } } };
    // Sem autor nem licenca a imagem nao pode ser exibida: melhor a ilustracao.
    expect(await fetchReferencePhoto('Turdus rufiventris', { endpoints: endpoints() })).toBeNull();
  });

  it('aceita licenca sem URL, preenchendo o autor ausente', async () => {
    scenario = {
      wikipedia: pageImagesResponse('Parcial.jpg'),
      commons: commonsResponse({ Artist: { value: '' }, LicenseUrl: undefined }),
    };
    const photo = await fetchReferencePhoto('Turdus rufiventris', { endpoints: endpoints() });
    expect(photo!.attribution.author).toBe('autoria nao informada');
    expect(photo!.attribution.license).toBe('CC BY-SA 4.0');
    expect(photo!.attribution.licenseUrl).toBeUndefined();
  });

  it('lanca quando o download da imagem falha', async () => {
    scenario = { wikipedia: pageImagesResponse('Erro.jpg'), commons: commonsResponse(), imageStatus: 500 };
    await expect(fetchReferencePhoto('Turdus rufiventris', { endpoints: endpoints() })).rejects.toThrow(/500/);
  });

  it('recusa conteudo que nao e imagem', async () => {
    scenario = {
      wikipedia: pageImagesResponse('Texto.jpg'),
      commons: commonsResponse(),
      imageType: 'text/html',
    };
    await expect(fetchReferencePhoto('Turdus rufiventris', { endpoints: endpoints() })).rejects.toThrow(/nao e uma imagem/);
  });

  it('respeita o cancelamento', async () => {
    scenario = { wikipedia: pageImagesResponse('a.jpg'), commons: commonsResponse() };
    const controller = new AbortController();
    controller.abort();
    // A busca do artigo engole o erro e tenta o proximo idioma; sem imagem
    // resolvida, o resultado e null em vez de uma excecao vazando para a tela.
    await expect(fetchReferencePhoto('Turdus rufiventris', { endpoints: endpoints(), signal: controller.signal })).resolves.toBeNull();
  });
});
