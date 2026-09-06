import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { startRecording, encodeWav, decodeAudioFile, type RecorderHandle } from '../engine/audio/recorder';
import { analyzeSong, identifyFromFeatures, metricsFrom, type SongAnalysis } from '../engine/analyze';
import type { Environment, FieldContext } from '../data/occurrence';
import { FieldHints } from '../components/FieldHints';
import { SONG_TYPES } from '../engine/audio/songType';
import { drawSpectrogram } from '../engine/audio/render';
import { newId, type Sighting } from '../engine/store/db';
import { persistSighting } from '../engine/store/capture';
import type { Settings } from '../engine/store/settings';
import { Badge, EvidenceList, Meter, Notice } from '../components/ui';
import { BirdArt } from '../components/BirdArt';
import { MicIcon, SongTypeIcon, StopIcon, UploadIcon, PinIcon, SparkIcon } from '../components/icons';

type Phase = 'idle' | 'recording' | 'analyzing' | 'done';

interface Props {
  settings: Settings;
  onSaved: () => void;
  onOpenSpecies: (id: string) => void;
  /** guarda o ambiente escolhido para nao repetir o toque na proxima gravacao */
  onEnvironmentChange: (environment: Environment) => void;
}

/** Espectrograma ao vivo: rola da direita pra esquerda enquanto grava. */
function useLiveSpectrogram(handle: RecorderHandle | null, canvasRef: React.RefObject<HTMLCanvasElement | null>) {
  useEffect(() => {
    if (!handle) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.round(canvas.clientWidth * dpr);
    const height = Math.round(canvas.clientHeight * dpr);
    canvas.width = width;
    canvas.height = height;
    ctx.fillStyle = '#080f11';
    ctx.fillRect(0, 0, width, height);

    const spectrum = new Float32Array(handle.spectrumBins);
    const nyquist = handle.sampleRate / 2;
    // Limita a faixa desenhada a 250 Hz - 12 kHz, a mesma que o motor analisa.
    const lowBin = Math.floor((250 / nyquist) * handle.spectrumBins);
    const highBin = Math.min(handle.spectrumBins - 1, Math.ceil((12000 / nyquist) * handle.spectrumBins));
    const logLow = Math.log2(Math.max(lowBin, 1));
    const logHigh = Math.log2(Math.max(highBin, lowBin + 1));

    let raf = 0;
    const column = 2 * dpr;

    const tick = () => {
      handle.readSpectrum(spectrum);
      // desloca o desenho para a esquerda e pinta a coluna nova na borda
      ctx.drawImage(canvas, -column, 0);
      for (let y = 0; y < height; y++) {
        const t = 1 - y / (height - 1 || 1);
        const bin = Math.round(2 ** (logLow + (logHigh - logLow) * t));
        const v = spectrum[Math.min(spectrum.length - 1, Math.max(0, bin))] ?? 0;
        const boosted = Math.min(1, v * 1.35);
        const r = Math.round(16 + boosted * 232);
        const g = Math.round(22 + boosted * 172);
        const b = Math.round(26 + boosted * 70);
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fillRect(width - column, y, column, 1);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [handle, canvasRef]);
}

export function ListenPage({ settings, onSaved, onOpenSpecies, onEnvironmentChange }: Props) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<SongAnalysis | null>(null);
  const [chosenSpecies, setChosenSpecies] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [context, setContext] = useState<FieldContext>({});
  const [audioUrl, setAudioUrl] = useState<string | null>(null);

  const handleRef = useRef<RecorderHandle | null>(null);
  const [liveHandle, setLiveHandle] = useState<RecorderHandle | null>(null);
  const liveCanvas = useRef<HTMLCanvasElement | null>(null);
  const resultCanvas = useRef<HTMLCanvasElement | null>(null);
  const recordedRef = useRef<Blob | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);

  useLiveSpectrogram(liveHandle, liveCanvas);

  // O ambiente costuma ser o mesmo entre gravacoes: pre-seleciona o que o
  // usuario escolheu nos ajustes para ele nao repetir o toque toda vez.
  useEffect(() => {
    setContext((current) =>
      current.environment === undefined && settings.defaultEnvironment
        ? { ...current, environment: settings.defaultEnvironment }
        : current,
    );
  }, [settings.defaultEnvironment]);

  // Reidentifica sem refazer a FFT quando as pistas mudam.
  const refined = useMemo(
    () => (analysis ? identifyFromFeatures(analysis.features, context) : null),
    [analysis, context],
  );
  const identification = refined?.identification ?? analysis?.identification ?? null;
  const songTypeResult = refined?.songType ?? analysis?.songType ?? null;

  // Desenha o espectrograma final assim que o resultado aparece.
  useEffect(() => {
    if (!analysis || !resultCanvas.current) return;
    const canvas = resultCanvas.current;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    drawSpectrogram(canvas, analysis.spectrogram, {
      width: Math.round(canvas.clientWidth * dpr),
      height: Math.round(canvas.clientHeight * dpr),
    });
  }, [analysis]);

  useEffect(
    () => () => {
      handleRef.current?.cancel();
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    },
    [audioUrl],
  );

  const runAnalysis = useCallback(
    (samples: Float32Array, sampleRate: number, audio: Blob | null) => {
      setPhase('analyzing');
      recordedRef.current = audio;
      // Um quadro de folga antes do trabalho pesado para o spinner realmente
      // aparecer: a analise e sincrona e travaria a pintura.
      requestAnimationFrame(() => {
        try {
          const result = analyzeSong(samples, sampleRate);
          setAnalysis(result);
          setChosenSpecies(result.identification.matches[0]?.species.id ?? null);
          setPhase('done');
          if (audio) {
            setAudioUrl((old) => {
              if (old) URL.revokeObjectURL(old);
              return URL.createObjectURL(audio);
            });
          }
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Falha ao analisar o audio.');
          setPhase('idle');
        }
      });
    },
    [],
  );

  const stop = useCallback(async () => {
    const handle = handleRef.current;
    if (!handle) return;
    handleRef.current = null;
    setLiveHandle(null);
    const { samples, sampleRate } = await handle.stop();
    if (samples.length < sampleRate * 0.4) {
      setError('Gravacao curta demais. Segure por pelo menos um segundo.');
      setPhase('idle');
      return;
    }
    const wav = settings.keepAudio ? encodeWav(samples, sampleRate) : null;
    runAnalysis(samples, sampleRate, wav);
  }, [runAnalysis, settings.keepAudio]);

  // Cronometro e medidor de nivel enquanto grava; para sozinho no tempo alvo.
  useEffect(() => {
    if (phase !== 'recording') return;
    const started = Date.now();
    const id = window.setInterval(() => {
      const seconds = (Date.now() - started) / 1000;
      setElapsed(seconds);
      setLevel(handleRef.current?.readLevel() ?? 0);
      if (seconds >= settings.recordSeconds) void stop();
    }, 100);
    return () => window.clearInterval(id);
  }, [phase, settings.recordSeconds, stop]);

  const start = async () => {
    setError(null);
    setAnalysis(null);
    setSaved(false);
    setElapsed(0);
    try {
      const handle = await startRecording();
      handleRef.current = handle;
      setLiveHandle(handle);
      setPhase('recording');
    } catch (err) {
      const message =
        err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'SecurityError')
          ? 'Permissao de microfone negada. Libere o acesso nas configuracoes do navegador e tente de novo.'
          : err instanceof Error
            ? err.message
            : 'Nao foi possivel acessar o microfone.';
      setError(message);
      setPhase('idle');
    }
  };

  const onFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setError(null);
    setSaved(false);
    setPhase('analyzing');
    try {
      const decoded = await decodeAudioFile(file);
      runAnalysis(decoded.samples, decoded.sampleRate, settings.keepAudio ? file : null);
    } catch {
      setError('Nao foi possivel ler este arquivo de audio.');
      setPhase('idle');
    }
  };

  const save = async () => {
    if (!analysis || !chosenSpecies) return;
    if (!identification || !songTypeResult) return;
    const match = identification.matches.find((m) => m.species.id === chosenSpecies);
    const probabilities = Object.fromEntries(
      songTypeResult.scores.map((s) => [s.type, Number(s.probability.toFixed(4))]),
    ) as Sighting['songTypeProbabilities'];

    const sighting: Sighting = {
      id: newId(),
      speciesId: chosenSpecies,
      kind: 'canto',
      timestamp: Date.now(),
      confidence: identification.confidence,
      probability: match?.probability ?? 0,
      alternatives: identification.matches
        .filter((m) => m.species.id !== chosenSpecies)
        .map((m) => ({ speciesId: m.species.id, probability: Number(m.probability.toFixed(4)) })),
      songType: songTypeResult!.top.type,
      songTypeProbabilities: probabilities,
      songTypeConfidence: songTypeResult!.confidence,
      metrics: metricsFrom(analysis.features),
      thumbnail: analysis.thumbnail,
      audio: recordedRef.current ?? undefined,
      verified: chosenSpecies !== identification.matches[0]?.species.id,
    };

    setSaving(true);
    try {
      await persistSighting(sighting, settings.saveLocation, onSaved);
      setSaved(true);
      onSaved();
    } catch (err) {
      setError(
        `Nao consegui guardar o registro: ${err instanceof Error ? err.message : 'erro no armazenamento local'}.`,
      );
    } finally {
      setSaving(false);
    }
  };

  // Quando as pistas mudam o topo muda: acompanha a selecao automaticamente,
  // a menos que o usuario ja tenha escolhido manualmente outra especie.
  const top = identification?.matches[0];
  useEffect(() => {
    if (!identification) return;
    const stillListed = identification.matches.some((m) => m.species.id === chosenSpecies);
    if (!stillListed) setChosenSpecies(identification.matches[0]?.species.id ?? null);
  }, [identification, chosenSpecies]);

  const songTypeInfo = songTypeResult ? SONG_TYPES[songTypeResult.top.type] : null;

  return (
    <div>
      {phase !== 'done' && (
        <div className="card">
          <div className="recorder">
            <button
              type="button"
              className={`recorder__button${phase === 'recording' ? ' recorder__button--recording' : ''}`}
              onClick={phase === 'recording' ? () => void stop() : () => void start()}
              disabled={phase === 'analyzing'}
              aria-label={phase === 'recording' ? 'Parar gravacao' : 'Gravar canto'}
            >
              {phase === 'recording' ? <StopIcon /> : <MicIcon />}
              <span>{phase === 'recording' ? 'Parar' : phase === 'analyzing' ? 'Analisando' : 'Gravar'}</span>
            </button>

            {phase === 'recording' && (
              <>
                <div className="recorder__timer" aria-live="off">
                  {elapsed.toFixed(1)}s
                  <span className="dim" style={{ fontSize: 16 }}>
                    {' '}
                    / {settings.recordSeconds}s
                  </span>
                </div>
                <div className="level" aria-hidden="true">
                  <div className="level__fill" style={{ width: `${Math.min(100, level * 220)}%` }} />
                </div>
              </>
            )}

            {phase === 'analyzing' && (
              <div className="row" style={{ color: 'var(--text-muted)' }}>
                <div className="spinner" />
                <span>Medindo frequencia, ritmo e melodia…</span>
              </div>
            )}

            {phase === 'idle' && (
              <p className="small dim" style={{ textAlign: 'center', maxWidth: 300, margin: 0 }}>
                Aponte o celular na direcao da ave e grave {settings.recordSeconds} segundos. Tudo e analisado no
                proprio aparelho, sem enviar nada para a internet.
              </p>
            )}
          </div>

          <canvas
            ref={liveCanvas}
            className="live-spectrogram"
            style={{ marginTop: 14, opacity: phase === 'recording' ? 1 : 0.35 }}
            aria-hidden="true"
          />

          {phase === 'idle' && (
            <>
              <button
                type="button"
                className="btn btn--ghost btn--block"
                style={{ marginTop: 12 }}
                onClick={() => fileInput.current?.click()}
              >
                <UploadIcon />
                Analisar um audio salvo
              </button>
              <input
                ref={fileInput}
                type="file"
                accept="audio/*"
                onChange={(e) => void onFile(e)}
                className="sr-only"
                aria-label="Escolher arquivo de audio"
              />
            </>
          )}
        </div>
      )}

      {error && (
        <div style={{ marginBottom: 14 }}>
          <Notice kind="error">{error}</Notice>
        </div>
      )}

      {phase === 'done' && analysis && (
        <div className="fade-in">
          <div className="card">
            <div className="card__title">Espectrograma</div>
            <div className="spectrogram-frame">
              <canvas ref={resultCanvas} className="live-spectrogram" aria-label="Espectrograma da gravacao" />
              <div className="spectrogram-frame__axis" aria-hidden="true">
                <span>12k</span>
                <span>3k</span>
                <span>250 Hz</span>
              </div>
            </div>
            <div className="tiny dim" style={{ marginTop: 8 }}>
              {analysis.features.durationSec.toFixed(1)} s · {analysis.features.noteCount} notas ·{' '}
              {Math.round(analysis.features.peakHz)} Hz dominante · analisado em {analysis.elapsedMs} ms neste aparelho
            </div>
          </div>

          <FieldHints
            value={context}
            onChange={(next) => {
              setContext(next);
              if (next.environment) onEnvironmentChange(next.environment);
            }}
          />

          {identification && identification.inconclusive ? (
            <Notice>
              Nao consegui casar este canto com nenhuma especie da base.{' '}
              {identification?.notes.join(' ')}
            </Notice>
          ) : (
            top && (
              <div className="card">
                <div className="card__title">Especie mais provavel</div>
                <div className="row" style={{ alignItems: 'flex-start' }}>
                  <div style={{ width: 84, flex: 'none', borderRadius: 12, overflow: 'hidden' }}>
                    <BirdArt species={top.species} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <button
                      type="button"
                      onClick={() => onOpenSpecies(top.species.id)}
                      style={{
                        textAlign: 'left',
                        padding: 0,
                        fontSize: 20,
                        fontWeight: 700,
                        letterSpacing: '-0.02em',
                        color: 'var(--text)',
                      }}
                    >
                      {top.species.commonName}
                    </button>
                    <div className="small dim" style={{ fontStyle: 'italic' }}>
                      {top.species.scientificName}
                    </div>
                    <div className="chips" style={{ marginTop: 8 }}>
                      <Badge>{Math.round(top.probability * 100)}% de aderencia</Badge>
                      <Badge outline>{top.species.family}</Badge>
                    </div>
                  </div>
                </div>

                <hr className="divider" />
                <div className="card__title">Por que</div>
                <EvidenceList items={top.reasons} />

                {identification && identification.matches.length > 1 && (
                  <>
                    <hr className="divider" />
                    <div className="card__title">Nao e essa? Corrija</div>
                    <div className="stack">
                      {identification?.matches.map((m) => (
                        <button
                          key={m.species.id}
                          type="button"
                          className="btn btn--block"
                          style={{
                            justifyContent: 'space-between',
                            borderColor:
                              chosenSpecies === m.species.id ? 'var(--accent)' : 'var(--line)',
                            background:
                              chosenSpecies === m.species.id ? 'var(--accent-dim)' : 'var(--bg-elevated)',
                          }}
                          onClick={() => setChosenSpecies(m.species.id)}
                          aria-pressed={chosenSpecies === m.species.id}
                        >
                          <span style={{ textAlign: 'left' }}>
                            {m.species.commonName}
                            <span className="dim tiny" style={{ display: 'block', fontWeight: 400 }}>
                              {m.species.scientificName}
                            </span>
                          </span>
                          <span className="dim" style={{ fontVariantNumeric: 'tabular-nums' }}>
                            {Math.round(m.probability * 100)}%
                          </span>
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )
          )}

          {songTypeInfo && (
            <div className="card">
              <div className="card__title">Tipo de canto</div>
              <div className="row" style={{ marginBottom: 12 }}>
                <span
                  className="icon-slot"
                  style={{ color: songTypeInfo.color, '--icon-size': '26px' } as React.CSSProperties}
                >
                  <SongTypeIcon kind={songTypeInfo.icon} />
                </span>
                <div>
                  <div style={{ fontSize: 17, fontWeight: 700 }}>{songTypeInfo.label}</div>
                  <div className="tiny dim">
                    confianca da leitura funcional: {Math.round(songTypeResult!.confidence * 100)}%
                  </div>
                </div>
              </div>

              <p className="small muted">{songTypeInfo.description}</p>

              <div className="stack" style={{ marginTop: 12 }}>
                {songTypeResult!.scores.map((score) => {
                  const info = SONG_TYPES[score.type];
                  return (
                    <Meter
                      key={score.type}
                      label={info.short}
                      value={score.probability}
                      color={info.color}
                    />
                  );
                })}
              </div>

              <hr className="divider" />
              <div className="card__title">Evidencia acustica</div>
              <EvidenceList
                items={songTypeResult!.top.evidence.map((e) => ({
                  label: e.label,
                  ok: e.weight > 0,
                  detail: e.measured,
                }))}
              />

              {songTypeResult!.caveats.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <Notice>{songTypeResult!.caveats.join(' ')}</Notice>
                </div>
              )}

              <div className="tiny dim" style={{ marginTop: 12, lineHeight: 1.45 }}>
                A funcao e inferida da estrutura fisica do som (frequencia, tom, ritmo e melodia), nao observada. E uma
                hipotese apoiada em bioacustica, nao um fato sobre a intencao da ave.
              </div>
            </div>
          )}

          {audioUrl && (
            <div className="card card--flat">
              <div className="card__title">Gravacao</div>
              {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
              <audio controls src={audioUrl} style={{ width: '100%' }} />
            </div>
          )}

          <div className="stack" style={{ marginBottom: 20 }}>
            {saved ? (
              <Notice kind="info">Registro guardado na sua pokedex.</Notice>
            ) : (
              <button
                type="button"
                className="btn btn--primary btn--block"
                onClick={() => void save()}
                disabled={!chosenSpecies || saving}
              >
                {saving ? <div className="spinner" /> : <SparkIcon />}
                {saving ? 'Guardando…' : 'Guardar na pokedex'}
              </button>
            )}
            <button
              type="button"
              className="btn btn--ghost btn--block"
              onClick={() => {
                setPhase('idle');
                setAnalysis(null);
                setSaved(false);
              }}
            >
              Gravar de novo
            </button>
            {settings.saveLocation && !saved && (
              <div className="tiny dim row" style={{ justifyContent: 'center' }}>
                <span className="icon-slot" style={{ '--icon-size': '14px' } as React.CSSProperties}>
                  <PinIcon />
                </span>
                a localizacao sera guardada junto
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
