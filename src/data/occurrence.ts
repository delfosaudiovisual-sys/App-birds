import type { Species } from './types';

/**
 * Contexto de campo: o que o observador sabe sem precisar de conhecimento
 * ornitologico — onde esta e qual o tamanho da ave.
 *
 * Isto existe porque a bancada mostrou que reduzir o conjunto de candidatos e,
 * de longe, o maior ganho de precisao disponivel: de 58 para 25 candidatos, o
 * acerto no primeiro palpite sobe de 21% para 38%. E tambem e como um
 * observador de campo realmente trabalha — ninguem compara um canto com todas
 * as aves do Brasil, compara com as que ocorrem ali.
 */

export type Environment = 'urbano' | 'mata' | 'campo' | 'agua';

export const ENVIRONMENT_LABELS: Record<Environment, string> = {
  urbano: 'Cidade / quintal',
  mata: 'Mata / floresta',
  campo: 'Campo aberto',
  agua: 'Beira d agua',
};

/**
 * Deriva o ambiente dos habitats ja descritos em cada especie, em vez de
 * duplicar a informacao numa tabela paralela — uma tabela paralela sairia do ar
 * assim que alguem editasse o habitat e esquecesse dela.
 */
const ENVIRONMENT_KEYWORDS: Record<Environment, string[]> = {
  urbano: ['cidade', 'quintal', 'parque', 'jardim', 'urban', 'pomar', 'praca', 'habitad'],
  mata: ['mata', 'floresta', 'capoeira', 'sub-bosque', 'araucaria', 'restinga', 'cerradao', 'palmeirais', 'copa'],
  campo: ['campo', 'pastagem', 'cerrado', 'caatinga', 'estrada', 'dunas', 'gramado', 'agricola', 'baldio', 'aberto'],
  agua: ['rio', 'lagoa', 'brejo', 'agua', 'mangue', 'manguezal', 'alagad', 'acude', 'represa', 'arrozais', 'pantanal'],
};

function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

export function environmentsFor(species: Species): Environment[] {
  const haystack = normalize(species.habitat.join(' '));
  const found = (Object.keys(ENVIRONMENT_KEYWORDS) as Environment[]).filter((env) =>
    ENVIRONMENT_KEYWORDS[env].some((word) => haystack.includes(word)),
  );
  // Sem palavra reconhecida, a especie fica compativel com tudo: e melhor nao
  // filtrar do que excluir por engano uma ave que esta bem na frente do usuario.
  return found.length ? found : (['urbano', 'mata', 'campo', 'agua'] as Environment[]);
}

export type SizeClass = 'minima' | 'pequena' | 'media' | 'grande';

export const SIZE_LABELS: Record<SizeClass, string> = {
  minima: 'Menor que um beija-flor grande (ate 12 cm)',
  pequena: 'Do tamanho de um pardal (12-20 cm)',
  media: 'Do tamanho de um pombo (20-35 cm)',
  grande: 'Maior que um pombo (acima de 35 cm)',
};

export const SIZE_SHORT: Record<SizeClass, string> = {
  minima: 'ate 12 cm',
  pequena: '12-20 cm',
  media: '20-35 cm',
  grande: '35 cm+',
};

/** Uma especie pode cruzar duas classes: a faixa de tamanho e um intervalo. */
export function sizeClassesFor(species: Species): SizeClass[] {
  const [min, max] = species.sizeCm;
  const classes: SizeClass[] = [];
  if (min <= 12) classes.push('minima');
  if (max >= 12 && min <= 20) classes.push('pequena');
  if (max >= 20 && min <= 35) classes.push('media');
  if (max >= 35) classes.push('grande');
  return classes.length ? classes : ['media'];
}

export interface FieldContext {
  environment?: Environment;
  sizeClass?: SizeClass;
}

/**
 * Peso do contexto: fora do esperado a especie NAO e eliminada, so recua.
 *
 * Eliminar seria arriscado demais — habitats sao aproximados, aves aparecem
 * fora do lugar e o usuario pode errar a estimativa de tamanho. Recuar preserva
 * o palpite improvavel na lista, apenas mais abaixo.
 */
const OUT_OF_CONTEXT = 0.45;

export function contextWeight(species: Species, context: FieldContext | undefined): number {
  if (!context) return 1;
  let weight = 1;
  if (context.environment && !environmentsFor(species).includes(context.environment)) weight *= OUT_OF_CONTEXT;
  if (context.sizeClass && !sizeClassesFor(species).includes(context.sizeClass)) weight *= OUT_OF_CONTEXT;
  return weight;
}
