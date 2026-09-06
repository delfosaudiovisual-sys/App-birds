import { useMemo, useState } from 'react';
import { ALL_SPECIES, SPECIES_NUMBER } from '../data/species';
import type { Species } from '../data/types';
import type { SpeciesProgress } from '../engine/store/db';
import { SpeciesImage } from '../components/SpeciesImage';
import { Empty, ProgressRing } from '../components/ui';
import { BookIcon, SearchIcon } from '../components/icons';

type Filter = 'todas' | 'descobertas' | 'faltando';

interface Props {
  progress: Map<string, SpeciesProgress>;
  onOpenSpecies: (id: string) => void;
  /** busca de fotos de referencia ligada nos ajustes */
  referencePhotos: boolean;
}

function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

export function DexPage({ progress, onOpenSpecies, referencePhotos }: Props) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('todas');

  const found = progress.size;
  const total = ALL_SPECIES.length;

  const visible = useMemo(() => {
    const q = normalize(query.trim());
    return ALL_SPECIES.filter((species) => {
      const discovered = progress.has(species.id);
      if (filter === 'descobertas' && !discovered) return false;
      if (filter === 'faltando' && discovered) return false;
      if (!q) return true;
      // Especie ainda nao descoberta so aparece na busca pelo nome cientifico
      // ou familia se ja foi vista — senao a busca vira gabarito da pokedex.
      const haystack = discovered
        ? [species.commonName, species.scientificName, species.family, ...(species.altNames ?? [])]
        : [species.commonName];
      return haystack.some((value) => normalize(value).includes(q));
    });
  }, [query, filter, progress]);

  return (
    <div>
      <div className="dex-progress">
        <ProgressRing value={total > 0 ? found / total : 0} />
        <div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>
            {found} de {total} especies
          </div>
          <div className="small dim">
            {found === 0
              ? 'Grave um canto ou envie uma foto para comecar a colecao.'
              : found === total
                ? 'Colecao completa. Impressionante.'
                : `Faltam ${total - found} para completar.`}
          </div>
        </div>
      </div>

      <div className="search">
        <SearchIcon />
        <input
          className="input"
          type="search"
          inputMode="search"
          placeholder="Buscar ave…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Buscar ave na pokedex"
        />
      </div>

      <div className="chips" style={{ marginBottom: 14 }}>
        {(['todas', 'descobertas', 'faltando'] as Filter[]).map((option) => (
          <button
            key={option}
            type="button"
            className="badge"
            aria-pressed={filter === option}
            style={{
              minHeight: 34,
              padding: '0 14px',
              background: filter === option ? 'var(--accent-dim)' : 'transparent',
              color: filter === option ? 'var(--accent-strong)' : 'var(--text-dim)',
              borderColor: filter === option ? 'transparent' : 'var(--line-strong)',
              textTransform: 'capitalize',
            }}
            onClick={() => setFilter(option)}
          >
            {option}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <Empty icon={<BookIcon />} title="Nada por aqui">
          Ajuste a busca ou o filtro.
        </Empty>
      ) : (
        <div className="dex-grid">
          {visible.map((species) => (
            <DexCard
              key={species.id}
              species={species}
              progress={progress.get(species.id)}
              referencePhotos={referencePhotos}
              onOpen={() => onOpenSpecies(species.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function DexCard({
  species,
  progress,
  referencePhotos,
  onOpen,
}: {
  species: Species;
  progress?: SpeciesProgress;
  referencePhotos: boolean;
  onOpen: () => void;
}) {
  const discovered = Boolean(progress);
  const number = SPECIES_NUMBER.get(species.id) ?? 0;

  return (
    <button
      type="button"
      className={`dex-card ${discovered ? 'dex-card--found' : 'dex-card--locked'}`}
      onClick={onOpen}
      aria-label={
        discovered
          ? `${species.commonName}, registrada ${progress?.count} vez(es)`
          : `Especie numero ${number} ainda nao descoberta`
      }
    >
      <span className="dex-card__num">#{String(number).padStart(3, '0')}</span>
      <div className="dex-card__art">
        <SpeciesImage
          species={species}
          locked={!discovered}
          userPhoto={progress?.userPhoto}
          allowReference={referencePhotos}
        />
      </div>
      <div>
        <div className="dex-card__name">{discovered ? species.commonName : '???'}</div>
        <div className="dex-card__sci">{discovered ? species.scientificName : '—'}</div>
      </div>
      {discovered && progress && (
        <div className="tiny dim" style={{ marginTop: 'auto' }}>
          {progress.count} registro{progress.count > 1 ? 's' : ''}
          {progress.songTypes.length > 0 && ` · ${progress.songTypes.length} tipo(s) de canto`}
        </div>
      )}
    </button>
  );
}
