import { useMemo, useState } from 'react';
import { getSpecies, SPECIES_NUMBER } from '../data/species';
import { SONG_TYPES, type SongTypeId } from '../engine/audio/songType';
import { deleteSighting, type Sighting } from '../engine/store/db';
import { BirdArt } from '../components/BirdArt';
import { Badge, CONSERVATION_LABELS, Empty, Notice, RARITY_LABELS } from '../components/ui';
import { BookIcon, ChevronLeftIcon, PinIcon, SongTypeIcon, TrashIcon } from '../components/icons';

interface Props {
  speciesId: string;
  sightings: Sighting[];
  onBack: () => void;
  onChanged: () => void;
}

const METRIC_LABELS: Record<string, { label: string; unit: string }> = {
  frequenciaPicoHz: { label: 'Frequencia dominante', unit: 'Hz' },
  frequenciaMinHz: { label: 'Frequencia minima', unit: 'Hz' },
  frequenciaMaxHz: { label: 'Frequencia maxima', unit: 'Hz' },
  larguraBandaHz: { label: 'Largura de banda', unit: 'Hz' },
  notas: { label: 'Notas', unit: '' },
  notasPorSegundo: { label: 'Velocidade', unit: 'notas/s' },
  duracaoNotaMs: { label: 'Duracao da nota', unit: 'ms' },
  duracaoFraseS: { label: 'Duracao da frase', unit: 's' },
  pureza: { label: 'Pureza tonal', unit: '' },
  modulacao: { label: 'Modulacao', unit: '' },
  repeticao: { label: 'Repeticao de frase', unit: '' },
  estereotipia: { label: 'Estereotipia', unit: '' },
  repertorio: { label: 'Repertorio', unit: '' },
  trinado: { label: 'Indice de trinado', unit: '' },
  relacaoSinalRuidoDb: { label: 'Sinal / ruido', unit: 'dB' },
};

function formatDate(ms: number): string {
  return new Date(ms).toLocaleString('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function SpeciesPage({ speciesId, sightings, onBack, onChanged }: Props) {
  const species = getSpecies(speciesId);
  const [expanded, setExpanded] = useState<string | null>(null);

  const mine = useMemo(
    () => sightings.filter((s) => s.speciesId === speciesId).sort((a, b) => b.timestamp - a.timestamp),
    [sightings, speciesId],
  );

  const songTypesSeen = useMemo(() => {
    const set = new Set<SongTypeId>();
    for (const s of mine) if (s.songType) set.add(s.songType);
    return [...set];
  }, [mine]);

  if (!species) {
    return (
      <div>
        <button type="button" className="btn btn--ghost" onClick={onBack}>
          <ChevronLeftIcon />
          Voltar
        </button>
        <Empty icon={<BookIcon />} title="Especie nao encontrada" />
      </div>
    );
  }

  const discovered = mine.length > 0;
  const number = SPECIES_NUMBER.get(species.id) ?? 0;

  return (
    <div className="fade-in">
      <button type="button" className="btn btn--ghost" style={{ marginBottom: 12 }} onClick={onBack}>
        <ChevronLeftIcon />
        Voltar
      </button>

      <div className="hero">
        <div className="hero__art">
          <BirdArt species={species} locked={!discovered} />
        </div>
        <div className="hero__body">
          <div className="tiny dim" style={{ fontWeight: 700, letterSpacing: '0.06em' }}>
            #{String(number).padStart(3, '0')}
          </div>
          <h2 style={{ fontSize: 24, marginTop: 2 }}>{discovered ? species.commonName : '???'}</h2>
          <div className="small dim" style={{ fontStyle: 'italic' }}>
            {discovered ? species.scientificName : 'Ainda nao registrada'}
          </div>
          <div className="chips" style={{ marginTop: 10 }}>
            <Badge outline>{species.family}</Badge>
            <Badge outline>{RARITY_LABELS[species.rarity]}</Badge>
            {species.conservation !== 'LC' && (
              <Badge color="var(--amber)">{CONSERVATION_LABELS[species.conservation]}</Badge>
            )}
            {songTypesSeen.map((id) => (
              <Badge key={id} color={SONG_TYPES[id].color}>
                {SONG_TYPES[id].short}
              </Badge>
            ))}
          </div>
        </div>
      </div>

      {!discovered ? (
        <Notice>
          Registre esta ave pelo canto ou por foto para liberar a ficha completa. Dica: ela ocorre em{' '}
          {species.habitat[0].toLowerCase()} e canta na faixa de {species.acoustic.peakHz[0]}–{species.acoustic.peakHz[1]} Hz.
        </Notice>
      ) : (
        <>
          <div className="card">
            <div className="card__title">Como reconhecer</div>
            <p className="small">{species.description}</p>
            <div className="facts" style={{ marginTop: 12 }}>
              <div className="fact">
                <div className="fact__label">Tamanho</div>
                <div className="fact__value">
                  {species.sizeCm[0]}–{species.sizeCm[1]} cm
                </div>
              </div>
              <div className="fact">
                <div className="fact__label">Familia</div>
                <div className="fact__value" style={{ fontSize: 13 }}>
                  {species.family}
                </div>
              </div>
              <div className="fact">
                <div className="fact__label">Conservacao</div>
                <div className="fact__value" style={{ fontSize: 13 }}>
                  {CONSERVATION_LABELS[species.conservation]}
                </div>
              </div>
              <div className="fact">
                <div className="fact__label">Frequencia do canto</div>
                <div className="fact__value" style={{ fontSize: 13 }}>
                  {(species.acoustic.peakHz[0] / 1000).toFixed(1)}–{(species.acoustic.peakHz[1] / 1000).toFixed(1)} kHz
                </div>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card__title">Canto</div>
            <p className="small">{species.songDescription}</p>
            <div className="chips">
              <Badge outline>ritmo: {species.acoustic.rhythm}</Badge>
              <Badge outline>
                {species.acoustic.noteRate[0]}–{species.acoustic.noteRate[1]} notas/s
              </Badge>
              <Badge outline>
                frase de {species.acoustic.phraseSec[0]}–{species.acoustic.phraseSec[1]} s
              </Badge>
            </div>
          </div>

          <div className="card">
            <div className="card__title">Comportamento</div>
            <p className="small">{species.behavior}</p>
            <hr className="divider" />
            <div className="card__title">Habitat</div>
            <div className="chips">
              {species.habitat.map((h) => (
                <Badge key={h} outline>
                  {h}
                </Badge>
              ))}
            </div>
            <div className="card__title" style={{ marginTop: 14 }}>
              Alimentacao
            </div>
            <div className="chips">
              {species.diet.map((d) => (
                <Badge key={d} outline>
                  {d}
                </Badge>
              ))}
            </div>
            <div className="card__title" style={{ marginTop: 14 }}>
              Distribuicao
            </div>
            <p className="small muted" style={{ margin: 0 }}>
              {species.distribution}
            </p>
          </div>

          <div className="card card--flat">
            <div className="card__title">Curiosidade</div>
            <p className="small" style={{ margin: 0 }}>
              {species.funFact}
            </p>
          </div>
        </>
      )}

      {mine.length > 0 && (
        <div className="card">
          <div className="card__title">Seus registros ({mine.length})</div>
          <div className="stack">
            {mine.map((sighting) => {
              const open = expanded === sighting.id;
              const songType = sighting.songType ? SONG_TYPES[sighting.songType] : null;
              return (
                <div
                  key={sighting.id}
                  style={{
                    border: '1px solid var(--line)',
                    borderRadius: 12,
                    overflow: 'hidden',
                    background: 'var(--bg-input)',
                  }}
                >
                  <button
                    type="button"
                    style={{ width: '100%', padding: 10, textAlign: 'left' }}
                    onClick={() => setExpanded(open ? null : sighting.id)}
                    aria-expanded={open}
                  >
                    {sighting.thumbnail && (
                      <img
                        src={sighting.thumbnail}
                        alt=""
                        style={{
                          width: '100%',
                          height: 76,
                          objectFit: 'cover',
                          borderRadius: 8,
                          marginBottom: 8,
                          display: 'block',
                        }}
                      />
                    )}
                    <div className="row" style={{ justifyContent: 'space-between' }}>
                      <span className="small">{formatDate(sighting.timestamp)}</span>
                      <span className="chips">
                        <Badge outline>{sighting.kind}</Badge>
                        {songType && <Badge color={songType.color}>{songType.short}</Badge>}
                      </span>
                    </div>
                  </button>

                  {open && (
                    <div style={{ padding: '0 10px 10px' }}>
                      {songType && sighting.songTypeProbabilities && (
                        <>
                          <div className="card__title" style={{ marginTop: 6 }}>
                            Probabilidade por funcao
                          </div>
                          <div className="stack" style={{ gap: 6 }}>
                            {(Object.entries(sighting.songTypeProbabilities) as [SongTypeId, number][])
                              .sort((a, b) => b[1] - a[1])
                              .map(([id, value]) => (
                                <div key={id} className="row" style={{ gap: 8 }}>
                                  <span
                                    className="icon-slot"
                                    style={
                                      { color: SONG_TYPES[id].color, '--icon-size': '18px' } as React.CSSProperties
                                    }
                                  >
                                    <SongTypeIcon kind={SONG_TYPES[id].icon} />
                                  </span>
                                  <span className="small" style={{ flex: 1 }}>
                                    {SONG_TYPES[id].short}
                                  </span>
                                  <span
                                    className="small"
                                    style={{ fontVariantNumeric: 'tabular-nums', color: SONG_TYPES[id].color }}
                                  >
                                    {Math.round(value * 100)}%
                                  </span>
                                </div>
                              ))}
                          </div>
                        </>
                      )}

                      {sighting.metrics && (
                        <>
                          <div className="card__title" style={{ marginTop: 12 }}>
                            Medidas acusticas
                          </div>
                          <div className="facts">
                            {Object.entries(sighting.metrics)
                              .filter(([key]) => METRIC_LABELS[key])
                              .map(([key, value]) => (
                                <div className="fact" key={key}>
                                  <div className="fact__label">{METRIC_LABELS[key].label}</div>
                                  <div className="fact__value" style={{ fontSize: 13 }}>
                                    {value} {METRIC_LABELS[key].unit}
                                  </div>
                                </div>
                              ))}
                          </div>
                        </>
                      )}

                      {sighting.note && (
                        <p className="small muted" style={{ marginTop: 12 }}>
                          {sighting.note}
                        </p>
                      )}

                      {sighting.location && (
                        <div className="row tiny dim" style={{ marginTop: 10 }}>
                          <span className="icon-slot" style={{ '--icon-size': '14px' } as React.CSSProperties}>
                            <PinIcon />
                          </span>
                          {sighting.location.lat.toFixed(4)}, {sighting.location.lon.toFixed(4)} (±
                          {Math.round(sighting.location.accuracy)} m)
                        </div>
                      )}

                      <button
                        type="button"
                        className="btn btn--ghost btn--danger btn--block"
                        style={{ marginTop: 12 }}
                        onClick={async () => {
                          await deleteSighting(sighting.id);
                          onChanged();
                        }}
                      >
                        <TrashIcon />
                        Apagar registro
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
