/**
 * Busca a foto de referencia de uma especie na Wikipedia / Wikimedia Commons.
 *
 * Por que buscar em vez de embutir: 58 fotos embutidas somariam alguns
 * megabytes ao pacote, congelariam a escolha da imagem e trariam o encargo de
 * versionar o credito de licenca de cada uma no repositorio. Buscar sob demanda
 * mantem o app pequeno, e a foto fica guardada no aparelho depois da primeira
 * vez — entao o modo offline continua valendo a partir da segunda visita.
 *
 * As imagens sao de terceiros e quase sempre exigem atribuicao (CC BY / BY-SA).
 * Autor, licenca e link da origem sao buscados junto e exibidos com a foto;
 * sem esses dados a foto simplesmente nao e usada.
 */

export interface PhotoAttribution {
  /** autor declarado no Commons, ja sem marcacao HTML */
  author: string;
  /** nome curto da licenca, ex.: "CC BY-SA 4.0" */
  license: string;
  /** link da licenca, quando o Commons informa */
  licenseUrl?: string;
  /** pagina de descricao do arquivo no Commons */
  sourceUrl: string;
  title: string;
}

export interface ReferencePhoto {
  blob: Blob;
  attribution: PhotoAttribution;
}

/** Injetavel para que os testes apontem para um servidor local. */
export interface Endpoints {
  wikipedia: (lang: string) => string;
  commons: string;
}

export const DEFAULT_ENDPOINTS: Endpoints = {
  wikipedia: (lang) => `https://${lang}.wikipedia.org/w/api.php`,
  commons: 'https://commons.wikimedia.org/w/api.php',
};

/** `origin=*` habilita CORS anonimo na Action API do MediaWiki. */
function apiUrl(base: string, params: Record<string, string>): string {
  const url = new URL(base);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  url.searchParams.set('format', 'json');
  url.searchParams.set('origin', '*');
  return url.toString();
}

async function getJson(url: string, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(url, { signal, headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`resposta ${response.status}`);
  return (await response.json()) as unknown;
}

interface PageImageResult {
  fileTitle?: string;
  thumbUrl?: string;
}

function readPageImages(payload: unknown): PageImageResult {
  const pages = (payload as { query?: { pages?: Record<string, unknown> } })?.query?.pages;
  if (!pages) return {};
  for (const page of Object.values(pages)) {
    const p = page as { pageimage?: string; thumbnail?: { source?: string }; missing?: string };
    if (p.missing !== undefined) continue;
    if (p.pageimage || p.thumbnail?.source) {
      return {
        fileTitle: p.pageimage ? `File:${p.pageimage}` : undefined,
        thumbUrl: p.thumbnail?.source,
      };
    }
  }
  return {};
}

/** O campo Artist do Commons vem como HTML; a interface mostra texto puro. */
export function stripHtml(value: string): string {
  return value
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

interface CommonsInfo {
  author: string;
  license: string;
  licenseUrl?: string;
  sourceUrl: string;
  imageUrl?: string;
}

function readCommonsInfo(payload: unknown): CommonsInfo | null {
  const pages = (payload as { query?: { pages?: Record<string, unknown> } })?.query?.pages;
  if (!pages) return null;
  for (const page of Object.values(pages)) {
    const info = (page as { imageinfo?: unknown[] }).imageinfo?.[0] as
      | {
          thumburl?: string;
          url?: string;
          descriptionurl?: string;
          extmetadata?: Record<string, { value?: string }>;
        }
      | undefined;
    if (!info) continue;
    const meta = info.extmetadata ?? {};
    const author = stripHtml(meta.Artist?.value ?? '');
    const license = stripHtml(meta.LicenseShortName?.value ?? meta.License?.value ?? '');
    if (!author && !license) continue;
    return {
      author: author || 'autoria nao informada',
      license: license || 'ver pagina do arquivo',
      licenseUrl: meta.LicenseUrl?.value,
      sourceUrl: info.descriptionurl ?? '',
      imageUrl: info.thumburl ?? info.url,
    };
  }
  return null;
}

export interface FetchOptions {
  /** idiomas tentados em ordem; o nome cientifico costuma existir em ambos */
  languages?: string[];
  endpoints?: Endpoints;
  signal?: AbortSignal;
  thumbSize?: number;
}

/**
 * Resolve a foto de uma especie a partir do nome cientifico.
 *
 * Devolve `null` — nunca lanca por ausencia — quando nao ha foto utilizavel,
 * porque a ilustracao vetorial cobre esse caso sem quebrar a tela.
 */
export async function fetchReferencePhoto(
  scientificName: string,
  options: FetchOptions = {},
): Promise<ReferencePhoto | null> {
  const endpoints = options.endpoints ?? DEFAULT_ENDPOINTS;
  const languages = options.languages ?? ['pt', 'en'];
  const thumbSize = String(options.thumbSize ?? 640);

  let found: PageImageResult = {};
  for (const lang of languages) {
    try {
      const payload = await getJson(
        apiUrl(endpoints.wikipedia(lang), {
          action: 'query',
          prop: 'pageimages',
          piprop: 'thumbnail|name',
          pithumbsize: thumbSize,
          redirects: '1',
          titles: scientificName,
        }),
        options.signal,
      );
      found = readPageImages(payload);
      if (found.fileTitle || found.thumbUrl) break;
    } catch {
      // idioma indisponivel ou artigo inexistente: tenta o proximo
    }
  }

  if (!found.fileTitle) return null;

  let info: CommonsInfo | null = null;
  try {
    const payload = await getJson(
      apiUrl(endpoints.commons, {
        action: 'query',
        prop: 'imageinfo',
        iiprop: 'url|extmetadata',
        iiurlwidth: thumbSize,
        titles: found.fileTitle,
      }),
      options.signal,
    );
    info = readCommonsInfo(payload);
  } catch {
    info = null;
  }

  // Sem credito nao ha foto: usar imagem de terceiro sem atribuir a licenca nao
  // e uma opcao, entao o app volta para a ilustracao.
  if (!info) return null;

  const imageUrl = info.imageUrl ?? found.thumbUrl;
  if (!imageUrl) return null;

  const response = await fetch(imageUrl, { signal: options.signal });
  if (!response.ok) throw new Error(`falha ao baixar a imagem (${response.status})`);
  const blob = await response.blob();
  if (!blob.type.startsWith('image/')) throw new Error('o arquivo baixado nao e uma imagem');

  return {
    blob,
    attribution: {
      author: info.author,
      license: info.license,
      licenseUrl: info.licenseUrl,
      sourceUrl: info.sourceUrl,
      title: found.fileTitle.replace(/^File:/, ''),
    },
  };
}
