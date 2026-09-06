import { useCallback, useEffect, useMemo, useState } from 'react';
import { buildProgress, listSightings, type Sighting } from './engine/store/db';
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type Settings } from './engine/store/settings';
import { ListenPage } from './pages/ListenPage';
import { PhotoPage } from './pages/PhotoPage';
import { DexPage } from './pages/DexPage';
import { SpeciesPage } from './pages/SpeciesPage';
import { SettingsPage } from './pages/SettingsPage';
import { BirdMarkIcon, BookIcon, CameraIcon, GearIcon, MicIcon } from './components/icons';
import { Notice } from './components/ui';

type Tab = 'ouvir' | 'foto' | 'dex' | 'ajustes';

const TABS: { id: Tab; label: string; icon: () => React.JSX.Element }[] = [
  { id: 'ouvir', label: 'Ouvir', icon: MicIcon },
  { id: 'foto', label: 'Foto', icon: CameraIcon },
  { id: 'dex', label: 'Pokedex', icon: BookIcon },
  { id: 'ajustes', label: 'Ajustes', icon: GearIcon },
];

const SUBTITLES: Record<Tab, string> = {
  ouvir: 'identificacao por canto',
  foto: 'identificacao por imagem',
  dex: 'sua colecao',
  ajustes: 'preferencias',
};

export default function App() {
  const [tab, setTab] = useState<Tab>('ouvir');
  const [openSpecies, setOpenSpecies] = useState<string | null>(null);
  const [sightings, setSightings] = useState<Sighting[]>([]);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [storageError, setStorageError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setSightings(await listSightings());
      setStorageError(null);
    } catch {
      setStorageError(
        'Nao consegui abrir o banco local. Em janela anonima o navegador costuma bloquear o armazenamento, e a pokedex nao sera salva.',
      );
    }
  }, []);

  useEffect(() => {
    setSettings(loadSettings());
    void refresh();
  }, [refresh]);

  // As preferencias de acessibilidade viram atributos no <html> para o CSS agir
  // sobre a pagina inteira, inclusive o que e renderizado fora do React.
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.largeText = String(settings.largeText);
    root.dataset.reduceMotion = String(settings.reduceMotion);
  }, [settings.largeText, settings.reduceMotion]);

  const updateSettings = useCallback((next: Settings) => {
    setSettings(next);
    saveSettings(next);
  }, []);

  const progress = useMemo(() => buildProgress(sightings), [sightings]);

  const goToSpecies = useCallback((id: string) => {
    setOpenSpecies(id);
    window.scrollTo({ top: 0 });
  }, []);

  const changeTab = useCallback((next: Tab) => {
    setOpenSpecies(null);
    setTab(next);
    window.scrollTo({ top: 0 });
  }, []);

  return (
    <div className="app">
      <main className="app__main">
        <header className="topbar">
          <BirdMarkIcon className="topbar__logo" />
          <div>
            <div className="topbar__title">Ornis</div>
            <div className="topbar__sub">{openSpecies ? 'ficha da especie' : SUBTITLES[tab]}</div>
          </div>
          <div className="topbar__spacer" />
          {progress.size > 0 && (
            <div className="tiny dim" style={{ textAlign: 'right' }}>
              {progress.size} especie{progress.size > 1 ? 's' : ''}
              <br />
              na pokedex
            </div>
          )}
        </header>

        {storageError && (
          <div style={{ marginBottom: 14 }}>
            <Notice kind="error">{storageError}</Notice>
          </div>
        )}

        {openSpecies ? (
          <SpeciesPage
            speciesId={openSpecies}
            sightings={sightings}
            onBack={() => setOpenSpecies(null)}
            onChanged={() => void refresh()}
          />
        ) : tab === 'ouvir' ? (
          <ListenPage settings={settings} onSaved={() => void refresh()} onOpenSpecies={goToSpecies} />
        ) : tab === 'foto' ? (
          <PhotoPage settings={settings} onSaved={() => void refresh()} onOpenSpecies={goToSpecies} />
        ) : tab === 'dex' ? (
          <DexPage progress={progress} onOpenSpecies={goToSpecies} />
        ) : (
          <SettingsPage
            settings={settings}
            onChange={updateSettings}
            onCleared={() => void refresh()}
            registered={sightings.length}
          />
        )}
      </main>

      <nav className="tabbar" aria-label="Navegacao principal">
        <div className="tabbar__inner">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              className="tabbar__item"
              aria-current={tab === id && !openSpecies ? 'page' : undefined}
              onClick={() => changeTab(id)}
            >
              <Icon />
              <span>{label}</span>
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}
