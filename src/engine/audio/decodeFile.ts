import type { RecordingResult } from './recorder';

/**
 * Decodificacao de arquivos de audio enviados pelo usuario.
 *
 * O caminho nativo (`decodeAudioData`) e sempre tentado primeiro: e rapido e
 * nao baixa nada. O problema e que a lista de formatos suportados varia muito
 * entre navegadores, e o Safari historicamente NAO decodifica o container Ogg —
 * que e exatamente o que o WhatsApp usa nos audios de voz (Ogg Opus). Sem
 * alternativa, o audio mais comum que alguem teria a mao para testar o app e
 * justamente o que nao abre.
 *
 * Por isso ha um segundo caminho: decodificadores em WebAssembly carregados sob
 * demanda. Quem envia um MP3 ou M4A nunca baixa esse codigo; so quem precisa.
 */

/** Assinatura de um container Ogg: os quatro primeiros bytes sao "OggS". */
function isOgg(bytes: Uint8Array): boolean {
  return bytes.length > 4 && bytes[0] === 0x4f && bytes[1] === 0x67 && bytes[2] === 0x67 && bytes[3] === 0x53;
}

/**
 * Descobre o codec dentro do Ogg lendo a primeira pagina.
 *
 * O cabecalho de identificacao vem logo no inicio: "OpusHead" para Opus,
 * "vorbis" para Vorbis. Basta olhar os primeiros bytes — nao e preciso
 * interpretar o container inteiro so para escolher o decodificador.
 */
function oggCodec(bytes: Uint8Array): 'opus' | 'vorbis' | 'desconhecido' {
  const head = bytes.subarray(0, Math.min(bytes.length, 128));
  let text = '';
  for (let i = 0; i < head.length; i++) text += String.fromCharCode(head[i]);
  if (text.includes('OpusHead')) return 'opus';
  if (text.includes('vorbis')) return 'vorbis';
  return 'desconhecido';
}

/** Junta os canais numa unica trilha: a analise e monofonica. */
function downmix(channels: Float32Array[], length: number): Float32Array {
  const out = new Float32Array(length);
  if (channels.length === 0) return out;
  for (const channel of channels) {
    const n = Math.min(length, channel.length);
    for (let i = 0; i < n; i++) out[i] += channel[i] / channels.length;
  }
  return out;
}

async function decodeNative(bytes: Uint8Array): Promise<RecordingResult> {
  const AudioCtx: typeof AudioContext =
    window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const context = new AudioCtx();
  try {
    // decodeAudioData ESVAZIA o ArrayBuffer recebido. Passar uma copia mantem
    // os bytes originais intactos para o caminho alternativo, caso este falhe.
    const copy = bytes.slice().buffer as ArrayBuffer;
    const buffer = await context.decodeAudioData(copy);
    const channels: Float32Array[] = [];
    for (let c = 0; c < buffer.numberOfChannels; c++) channels.push(buffer.getChannelData(c));
    return {
      samples: downmix(channels, buffer.length),
      sampleRate: buffer.sampleRate,
      durationSec: buffer.duration,
    };
  } finally {
    void context.close();
  }
}

async function decodeOggOpus(bytes: Uint8Array): Promise<RecordingResult> {
  const { OggOpusDecoder } = await import('ogg-opus-decoder');
  const decoder = new OggOpusDecoder();
  try {
    await decoder.ready;
    const result = await decoder.decodeFile(bytes);
    if (result.samplesDecoded <= 0) throw new Error('nenhuma amostra decodificada');
    return {
      samples: downmix(result.channelData, result.samplesDecoded),
      sampleRate: result.sampleRate,
      durationSec: result.samplesDecoded / result.sampleRate,
    };
  } finally {
    decoder.free();
  }
}

async function decodeOggVorbis(bytes: Uint8Array): Promise<RecordingResult> {
  const { OggVorbisDecoder } = await import('@wasm-audio-decoders/ogg-vorbis');
  const decoder = new OggVorbisDecoder();
  try {
    await decoder.ready;
    const result = await decoder.decodeFile(bytes);
    if (result.samplesDecoded <= 0) throw new Error('nenhuma amostra decodificada');
    return {
      samples: downmix(result.channelData, result.samplesDecoded),
      sampleRate: result.sampleRate,
      durationSec: result.samplesDecoded / result.sampleRate,
    };
  } finally {
    await decoder.free();
  }
}

function describe(file: { name?: string; type?: string }): string {
  const name = file.name ? ` "${file.name}"` : '';
  const type = file.type ? ` (${file.type})` : '';
  return `${name}${type}`;
}

export async function decodeAudioFile(file: Blob & { name?: string }): Promise<RecordingResult> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length === 0) throw new Error('O arquivo esta vazio.');

  try {
    return await decodeNative(bytes);
  } catch (nativeError) {
    if (isOgg(bytes)) {
      const codec = oggCodec(bytes);
      if (codec === 'opus') return decodeOggOpus(bytes);
      if (codec === 'vorbis') return decodeOggVorbis(bytes);
      throw new Error('Arquivo Ogg com codec nao reconhecido. Converta para MP3, WAV ou M4A e tente de novo.');
    }
    throw new Error(
      `Nao consegui ler este arquivo de audio${describe(file)}. ` +
        `Formatos que costumam funcionar: MP3, WAV, M4A, AAC, OGG e OPUS. ` +
        `Detalhe: ${nativeError instanceof Error ? nativeError.message : 'formato nao suportado'}`,
    );
  }
}

/** Exportado para teste: identifica o que ha dentro de um arquivo. */
export const __testing = { isOgg, oggCodec, downmix };
