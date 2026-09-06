import { useRef, useState } from 'react';
import { loadImageFile } from '../engine/vision/loadImage';
import { analyzePhoto, type PhotoAnalysis, type PhotoBoost } from '../engine/analyze';
import { newId, type Sighting } from '../engine/store/db';
import { persistSighting } from '../engine/store/capture';
import type { Settings } from '../engine/store/settings';
import { Badge, EvidenceList, Notice } from '../components/ui';
import { BirdArt } from '../components/BirdArt';
import { CameraIcon, UploadIcon, SparkIcon } from '../components/icons';

interface Props {
  settings: Settings;
  onSaved: () => void;
  onOpenSpecies: (id: string) => void;
}

export function PhotoPage({ settings, onSaved, onOpenSpecies }: Props) {
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<PhotoAnalysis | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  const cameraInput = useRef<HTMLInputElement | null>(null);
  const galleryInput = useRef<HTMLInputElement | null>(null);

  const handleFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setError(null);
    setSaved(false);
    setAnalysis(null);
    setBusy(true);
    setBusyLabel('Lendo a imagem…');

    try {
      const image = await loadImageFile(file);

      let boost: PhotoBoost | undefined;
      let assistNote: string | undefined;

      // A analise local roda sempre. O modelo de visao, quando ligado, entra
      // como reforco — se falhar, o resultado local continua valendo.
      if (settings.cloudEnabled && settings.cloudApiKey) {
        setBusyLabel('Consultando o modelo de visao…');
        try {
          const { identifyWithVisionModel, assistToBoost } = await import('../engine/cloud/visionAssist');
          const result = await identifyWithVisionModel({
            apiKey: settings.cloudApiKey,
            imageDataUrl: image.thumbnail,
          });
          if (result.noBird) {
            setError('O modelo nao encontrou uma ave identificavel nesta foto.');
          } else {
            boost = assistToBoost(result);
            assistNote = result.observation;
          }
        } catch (err) {
          assistNote = undefined;
          setError(
            `Identificacao assistida indisponivel (${
              err instanceof Error ? err.message : 'erro desconhecido'
            }). Usando so a analise local.`,
          );
        }
      }

      setBusyLabel('Comparando plumagem…');
      const result = analyzePhoto(image, boost, assistNote);
      setAnalysis(result);
      setChosen(result.identification.matches[0]?.species.id ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nao foi possivel abrir esta imagem.');
    } finally {
      setBusy(false);
      setBusyLabel('');
    }
  };

  const save = async () => {
    if (!analysis || !chosen) return;
    const match = analysis.identification.matches.find((m) => m.species.id === chosen);
    const sighting: Sighting = {
      id: newId(),
      speciesId: chosen,
      kind: 'foto',
      timestamp: Date.now(),
      confidence: analysis.identification.confidence,
      probability: match?.probability ?? 0,
      alternatives: analysis.identification.matches
        .filter((m) => m.species.id !== chosen)
        .map((m) => ({ speciesId: m.species.id, probability: Number(m.probability.toFixed(4)) })),
      thumbnail: analysis.thumbnail,
      note: analysis.assistNote,
      verified: chosen !== analysis.identification.matches[0]?.species.id,
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

  const top = analysis?.identification.matches[0];

  return (
    <div>
      {!analysis && (
        <div className="card">
          <div className="card__title">Identificar por foto</div>
          <p className="small muted">
            Enquadre a ave o maior possivel e evite contraluz. O app mede a paleta de plumagem, o padrao (liso, barrado,
            mascarado), o contraste e a silhueta, e compara com a base de especies.
          </p>

          <div className="stack" style={{ marginTop: 14 }}>
            <button
              type="button"
              className="btn btn--primary btn--block"
              onClick={() => cameraInput.current?.click()}
              disabled={busy}
            >
              <CameraIcon />
              Tirar foto agora
            </button>
            <button
              type="button"
              className="btn btn--block"
              onClick={() => galleryInput.current?.click()}
              disabled={busy}
            >
              <UploadIcon />
              Escolher da galeria
            </button>
          </div>

          <input
            ref={cameraInput}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={(e) => void handleFile(e)}
            className="sr-only"
            aria-label="Tirar foto da ave"
          />
          <input
            ref={galleryInput}
            type="file"
            accept="image/*"
            onChange={(e) => void handleFile(e)}
            className="sr-only"
            aria-label="Escolher foto da galeria"
          />

          {busy && (
            <div className="row" style={{ marginTop: 14, color: 'var(--text-muted)' }}>
              <div className="spinner" />
              <span>{busyLabel}</span>
            </div>
          )}

          {!settings.cloudEnabled && (
            <div style={{ marginTop: 14 }}>
              <Notice kind="info">
                A identificacao por foto usa cor, padrao e silhueta, entao vai bem com aves de plumagem marcante e
                menos bem com pardos parecidos. Para maior precisao, ligue a identificacao assistida em Ajustes — ou
                confirme pelo canto.
              </Notice>
            </div>
          )}
        </div>
      )}

      {error && (
        <div style={{ marginBottom: 14 }}>
          <Notice kind="error">{error}</Notice>
        </div>
      )}

      {analysis && (
        <div className="fade-in">
          <div className="hero">
            <div className="hero__art">
              <img src={analysis.thumbnail} alt="Foto enviada para identificacao" />
            </div>
          </div>

          {analysis.assistNote && (
            <div className="card card--flat">
              <div className="card__title">Observacao do modelo de visao</div>
              <p className="small muted" style={{ margin: 0 }}>
                {analysis.assistNote}
              </p>
            </div>
          )}

          {analysis.identification.inconclusive && (
            <Notice>{analysis.identification.notes.join(' ')}</Notice>
          )}

          {top && (
            <div className="card">
              <div className="card__title">
                Especie mais provavel
                {analysis.identification.assistedBy && ` · reforcada por ${analysis.identification.assistedBy}`}
              </div>
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

              <hr className="divider" />
              <div className="card__title">Nao e essa? Corrija</div>
              <div className="stack">
                {analysis.identification.matches.map((m) => (
                  <button
                    key={m.species.id}
                    type="button"
                    className="btn btn--block"
                    style={{
                      justifyContent: 'space-between',
                      borderColor: chosen === m.species.id ? 'var(--accent)' : 'var(--line)',
                      background: chosen === m.species.id ? 'var(--accent-dim)' : 'var(--bg-elevated)',
                    }}
                    onClick={() => setChosen(m.species.id)}
                    aria-pressed={chosen === m.species.id}
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
                disabled={!chosen || saving}
              >
                {saving ? <div className="spinner" /> : <SparkIcon />}
                {saving ? 'Guardando…' : 'Guardar na pokedex'}
              </button>
            )}
            <button
              type="button"
              className="btn btn--ghost btn--block"
              onClick={() => {
                setAnalysis(null);
                setSaved(false);
                setError(null);
              }}
            >
              Enviar outra foto
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
