import { ALL_SPECIES } from '../../data/species';

/**
 * Identificacao assistida por modelo de visao (opcional).
 *
 * Roda direto do navegador com a chave do proprio usuario. Isso e comodo para
 * um app pessoal, mas tem um custo real de seguranca: uma chave guardada no
 * navegador fica exposta a qualquer extensao ou script que rode na pagina, e
 * viaja do aparelho para a API. Por isso o recurso vem DESLIGADO por padrao,
 * a tela de ajustes avisa, e o resultado entra apenas como reforco — nunca
 * substitui a analise local, que continua funcionando offline.
 *
 * O SDK e importado dinamicamente para nao entrar no pacote inicial: quem nao
 * liga o recurso nunca baixa esse codigo.
 */

export interface AssistResult {
  /** ids da base local, do mais provavel ao menos */
  speciesIds: string[];
  /** familias sugeridas, quando a especie exata nao esta na base */
  families: string[];
  /** 0-1 declarada pelo modelo */
  confidence: number;
  /** o que o modelo observou, em portugues */
  observation: string;
  /** true quando o modelo diz que nao ha ave na foto */
  noBird: boolean;
}

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    species_ids: {
      type: 'array',
      items: { type: 'string' },
      description: 'Ids da lista fornecida, do mais provavel ao menos provavel, no maximo 3. Vazio se nenhum servir.',
    },
    families: {
      type: 'array',
      items: { type: 'string' },
      description: 'Familias taxonomicas provaveis, ex.: Thraupidae. No maximo 2.',
    },
    confidence: {
      type: 'number',
      description: 'Confianca de 0 a 1 na identificacao.',
    },
    observation: {
      type: 'string',
      description: 'Uma ou duas frases em portugues do Brasil descrevendo as marcas de campo visiveis.',
    },
    no_bird: {
      type: 'boolean',
      description: 'true se a imagem nao contem uma ave identificavel.',
    },
  },
  required: ['species_ids', 'families', 'confidence', 'observation', 'no_bird'],
  additionalProperties: false,
} as const;

function catalogue(): string {
  return ALL_SPECIES.map((s) => `${s.id} = ${s.commonName} (${s.scientificName}, ${s.family})`).join('\n');
}

const SYSTEM_PROMPT = `Voce e um ornitologo de campo brasileiro identificando aves em fotos.

Responda apenas com base no que esta visivel na imagem. Se a foto estiver desfocada,
contra a luz ou mostrar so uma silhueta, diga isso na observacao e devolva confianca baixa
em vez de arriscar um nome. Se a ave nao estiver na lista fornecida, deixe species_ids vazio
e preencha families com a familia mais provavel.

Escreva a observacao em portugues do Brasil, citando marcas de campo concretas
(cor do bico, sobrancelha, barras na asa, cor do ventre), nao impressoes gerais.`;

export interface AssistOptions {
  apiKey: string;
  /** data URL (image/jpeg ou image/png) da foto */
  imageDataUrl: string;
  signal?: AbortSignal;
}

export async function identifyWithVisionModel(options: AssistOptions): Promise<AssistResult> {
  const { apiKey, imageDataUrl } = options;
  if (!apiKey) throw new Error('Chave da API nao configurada.');

  const match = /^data:(image\/(?:jpeg|png|webp|gif));base64,(.+)$/.exec(imageDataUrl);
  if (!match) throw new Error('Formato de imagem nao suportado para o envio.');
  const [, mediaType, base64] = match;

  const [{ default: Anthropic }, { jsonSchemaOutputFormat }] = await Promise.all([
    import('@anthropic-ai/sdk'),
    import('@anthropic-ai/sdk/helpers/json-schema'),
  ]);

  const client = new Anthropic({
    apiKey,
    // Necessario para chamar a API a partir da pagina; ver o aviso no topo.
    dangerouslyAllowBrowser: true,
    maxRetries: 1,
  });

  const response = await client.messages.parse(
    {
      model: 'claude-opus-5',
      max_tokens: 2000,
      system: SYSTEM_PROMPT,
      output_config: {
        effort: 'medium',
        format: jsonSchemaOutputFormat(OUTPUT_SCHEMA),
      },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType as 'image/jpeg', data: base64 } },
            {
              type: 'text',
              text: `Identifique a ave desta foto.\n\nEspecies disponiveis na base do aplicativo:\n${catalogue()}`,
            },
          ],
        },
      ],
    },
    { signal: options.signal },
  );

  if (response.stop_reason === 'refusal') {
    throw new Error('O modelo recusou analisar esta imagem.');
  }

  const parsed = response.parsed_output;
  if (!parsed) throw new Error('Nao foi possivel interpretar a resposta do modelo.');

  return {
    speciesIds: (parsed.species_ids ?? []).slice(0, 3),
    families: (parsed.families ?? []).slice(0, 2),
    confidence: Math.max(0, Math.min(1, parsed.confidence ?? 0)),
    observation: parsed.observation ?? '',
    noBird: parsed.no_bird === true,
  };
}

/** Converte a resposta do modelo no formato de reforco que o matcher entende. */
export function assistToBoost(result: AssistResult): {
  bySpecies: Record<string, number>;
  byFamily: Record<string, number>;
  source: string;
} {
  const bySpecies: Record<string, number> = {};
  result.speciesIds.forEach((id, index) => {
    bySpecies[id] = result.confidence * (1 - index * 0.25);
  });
  const byFamily: Record<string, number> = {};
  result.families.forEach((family, index) => {
    byFamily[family] = result.confidence * 0.6 * (1 - index * 0.3);
  });
  return { bySpecies, byFamily, source: 'modelo de visao' };
}
