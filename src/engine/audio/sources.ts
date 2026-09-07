import type { Note } from './features';

/**
 * Separacao de fontes sonoras dentro de uma gravacao.
 *
 * Por que isto existe: medir as caracteristicas do arquivo INTEIRO de uma vez
 * so descreve bem uma gravacao que tenha exatamente uma ave e nada mais. Numa
 * gravacao de quintal ha silencio, ruido e outras aves, e a media de tudo isso
 * e um "canto" que nenhuma das aves cantou. O banco de provas de cena mostrou o
 * tamanho do estrago: basta UMA ave ao fundo para o acerto cair de 17% para
 * 4%, praticamente sorteio.
 *
 * A separacao usa duas pistas independentes, porque aves se separam de dois
 * jeitos diferentes:
 *
 *  - NO TEMPO: cada ave canta em rajadas, com silencio entre elas. Recortar por
 *    silencio ja isola a maioria dos casos.
 *  - NA FREQUENCIA: quando duas aves cantam ao mesmo tempo, o tempo nao separa,
 *    mas a altura sim — uma corruira a 6 kHz e uma rolinha a 700 Hz ocupam
 *    regioes que nao se tocam. Filtrar a faixa isola cada uma.
 */

export interface SoundSource {
  /** de onde veio o recorte, para explicar na tela */
  kind: 'inteiro' | 'trecho' | 'faixa';
  startSec: number;
  endSec: number;
  lowHz: number;
  highHz: number;
  noteCount: number;
  samples: Float32Array;
}

/**
 * Biquad passa-banda (Robert Bristow-Johnson), aplicado nos dois sentidos.
 *
 * Ida e volta cancelam o deslocamento de fase, o que importa aqui: a analise
 * mede tempos de ataque e duracao de nota, e um filtro que atrasa as
 * frequencias de forma desigual borraria justamente essas medidas.
 */
function bandpass(input: Float32Array, sampleRate: number, lowHz: number, highHz: number): Float32Array {
  const center = Math.sqrt(Math.max(lowHz, 20) * Math.min(highHz, sampleRate / 2 - 100));
  const bandwidth = Math.max(highHz - lowHz, center * 0.35);
  const q = Math.max(0.4, center / bandwidth);

  const w0 = (2 * Math.PI * center) / sampleRate;
  const alpha = Math.sin(w0) / (2 * q);
  const cosw0 = Math.cos(w0);

  const b0 = alpha;
  const b1 = 0;
  const b2 = -alpha;
  const a0 = 1 + alpha;
  const a1 = -2 * cosw0;
  const a2 = 1 - alpha;

  const B0 = b0 / a0;
  const B1 = b1 / a0;
  const B2 = b2 / a0;
  const A1 = a1 / a0;
  const A2 = a2 / a0;

  const run = (data: Float32Array, reverse: boolean) => {
    const out = new Float32Array(data.length);
    let x1 = 0;
    let x2 = 0;
    let y1 = 0;
    let y2 = 0;
    for (let k = 0; k < data.length; k++) {
      const i = reverse ? data.length - 1 - k : k;
      const x0 = data[i];
      const y0 = B0 * x0 + B1 * x1 + B2 * x2 - A1 * y1 - A2 * y2;
      x2 = x1;
      x1 = x0;
      y2 = y1;
      y1 = y0;
      out[i] = y0;
    }
    return out;
  };

  return run(run(input, false), true);
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function slice(samples: Float32Array, sampleRate: number, startSec: number, endSec: number): Float32Array {
  const from = Math.max(0, Math.floor(startSec * sampleRate));
  const to = Math.min(samples.length, Math.ceil(endSec * sampleRate));
  return samples.slice(from, Math.max(from + 1, to));
}

/** Rajadas: grupos de notas separados por um silencio muito maior que o normal. */
function timeBouts(notes: Note[]): { startSec: number; endSec: number; notes: Note[] }[] {
  if (notes.length < 2) return [];
  const gaps: number[] = [];
  for (let i = 1; i < notes.length; i++) gaps.push(notes[i].startSec - notes[i - 1].endSec);
  const typical = median(gaps);
  const boundary = Math.max(0.45, typical * 4);

  const bouts: { startSec: number; endSec: number; notes: Note[] }[] = [];
  let group: Note[] = [notes[0]];
  for (let i = 1; i < notes.length; i++) {
    if (notes[i].startSec - notes[i - 1].endSec > boundary) {
      bouts.push({ startSec: group[0].startSec, endSec: group[group.length - 1].endSec, notes: group });
      group = [];
    }
    group.push(notes[i]);
  }
  if (group.length) bouts.push({ startSec: group[0].startSec, endSec: group[group.length - 1].endSec, notes: group });
  return bouts.filter((b) => b.notes.length >= 2);
}

/**
 * Faixas: grupos de notas proximas em altura.
 *
 * O agrupamento e em oitavas, nao em hertz — 500 e 1000 Hz sao tao distantes
 * quanto 4000 e 8000, e um limite em hertz juntaria as agudas e separaria as
 * graves sem motivo.
 */
function frequencyBands(notes: Note[]): { lowHz: number; highHz: number; notes: Note[] }[] {
  const valid = notes.filter((n) => n.peakHz > 0);
  if (valid.length < 4) return [];

  const sorted = [...valid].sort((a, b) => a.peakHz - b.peakHz);
  const groups: Note[][] = [[sorted[0]]];
  const SPLIT_OCTAVES = 0.75;

  for (let i = 1; i < sorted.length; i++) {
    const previous = sorted[i - 1].peakHz;
    const current = sorted[i].peakHz;
    if (Math.abs(Math.log2(current / Math.max(previous, 1))) > SPLIT_OCTAVES) groups.push([]);
    groups[groups.length - 1].push(sorted[i]);
  }

  return groups
    .filter((g) => g.length >= 3)
    .map((g) => {
      const lows = g.map((n) => (n.lowHz > 0 ? n.lowHz : n.peakHz * 0.8));
      const highs = g.map((n) => (n.highHz > 0 ? n.highHz : n.peakHz * 1.25));
      return {
        lowHz: Math.max(200, Math.min(...lows) * 0.8),
        highHz: Math.min(14000, Math.max(...highs) * 1.25),
        notes: g,
      };
    });
}

export interface FindSourcesOptions {
  /** teto de candidatos analisados, para nao estourar o tempo em arquivos longos */
  maxSources?: number;
}

/**
 * Monta os candidatos a analisar. O trecho inteiro entra sempre como um deles,
 * para que a separacao nunca piore o resultado: se nenhum recorte casar melhor
 * que o arquivo completo, o completo vence.
 */
export function findSources(
  samples: Float32Array,
  sampleRate: number,
  notes: Note[],
  options: FindSourcesOptions = {},
): SoundSource[] {
  const maxSources = options.maxSources ?? 5;
  const durationSec = samples.length / sampleRate;

  const sources: SoundSource[] = [
    {
      kind: 'inteiro',
      startSec: 0,
      endSec: durationSec,
      lowHz: 0,
      highHz: sampleRate / 2,
      noteCount: notes.length,
      samples,
    },
  ];

  const bouts = timeBouts(notes);
  // Uma rajada so interessa se recortar de fato: se ela cobre quase toda a
  // gravacao, e o mesmo candidato que ja esta na lista.
  for (const bout of bouts) {
    const span = bout.endSec - bout.startSec;
    if (span < 0.25 || span > durationSec * 0.92) continue;
    const pad = 0.12;
    sources.push({
      kind: 'trecho',
      startSec: Math.max(0, bout.startSec - pad),
      endSec: Math.min(durationSec, bout.endSec + pad),
      lowHz: 0,
      highHz: sampleRate / 2,
      noteCount: bout.notes.length,
      samples: slice(samples, sampleRate, bout.startSec - pad, bout.endSec + pad),
    });
  }

  const bands = frequencyBands(notes);
  // Uma unica faixa significa que todas as notas estao na mesma regiao: nao ha
  // o que separar, e filtrar so removeria harmonicas uteis.
  if (bands.length > 1) {
    for (const band of bands) {
      const startSec = Math.max(0, Math.min(...band.notes.map((n) => n.startSec)) - 0.12);
      const endSec = Math.min(durationSec, Math.max(...band.notes.map((n) => n.endSec)) + 0.12);
      const filtered = bandpass(slice(samples, sampleRate, startSec, endSec), sampleRate, band.lowHz, band.highHz);
      sources.push({
        kind: 'faixa',
        startSec,
        endSec,
        lowHz: band.lowHz,
        highHz: band.highHz,
        noteCount: band.notes.length,
        samples: filtered,
      });
    }
  }

  // Mais notas primeiro: um recorte com dez notas descreve um canto melhor que
  // um com duas. O arquivo inteiro fica sempre na lista, mesmo que seja cortado
  // pelo teto, porque e a garantia de nao regredir.
  const rest = sources
    .slice(1)
    .sort((a, b) => b.noteCount - a.noteCount)
    .slice(0, maxSources - 1);

  return [sources[0], ...rest];
}

export const __testing = { bandpass, timeBouts, frequencyBands };
