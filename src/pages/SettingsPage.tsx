import { useEffect, useState } from 'react';
import { clearAll, clearStoredPhotos, listStoredPhotos } from '../engine/store/db';
import { resetPhotoFailures } from '../engine/photos/photoStore';
import { ENVIRONMENT_LABELS, type Environment } from '../data/occurrence';
import type { Settings } from '../engine/store/settings';
import { Notice, Switch } from '../components/ui';
import { TrashIcon } from '../components/icons';

interface Props {
  settings: Settings;
  onChange: (next: Settings) => void;
  onCleared: () => void;
  registered: number;
}

export function SettingsPage({ settings, onChange, onCleared, registered }: Props) {
  const [confirmClear, setConfirmClear] = useState(false);
  const [photoCount, setPhotoCount] = useState(0);
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => onChange({ ...settings, [key]: value });

  useEffect(() => {
    void listStoredPhotos()
      .then((photos) => setPhotoCount(photos.length))
      .catch(() => setPhotoCount(0));
  }, []);

  return (
    <div>
      <div className="card">
        <div className="card__title">Gravacao</div>
        <div className="field">
          <label className="field__label" htmlFor="record-seconds">
            Duracao da gravacao: {settings.recordSeconds} s
          </label>
          <input
            id="record-seconds"
            type="range"
            min={4}
            max={20}
            step={1}
            value={settings.recordSeconds}
            onChange={(e) => set('recordSeconds', Number(e.target.value))}
            style={{ width: '100%', accentColor: 'var(--accent)' }}
          />
          <div className="field__hint">
            Trechos mais longos permitem medir repeticao de frase e repertorio, o que melhora tanto a especie quanto a
            leitura do tipo de canto. Abaixo de 5 s, contato e alarme ficam dificeis de separar.
          </div>
        </div>

        <Switch
          label="Guardar o audio original"
          hint="Permite reouvir o registro depois. Ocupa cerca de 350 KB por gravacao."
          checked={settings.keepAudio}
          onChange={(v) => set('keepAudio', v)}
        />
        <Switch
          label="Guardar a localizacao"
          hint="Anexa as coordenadas ao registro. Fica so no seu aparelho."
          checked={settings.saveLocation}
          onChange={(v) => set('saveLocation', v)}
        />
      </div>

      <div className="card">
        <div className="card__title">Fotos das aves</div>
        <Switch
          label="Baixar fotos reais das especies"
          hint="Busca a foto de cada ave na Wikimedia Commons, uma unica vez, e guarda no aparelho. Depois disso funciona offline."
          checked={settings.referencePhotos}
          onChange={(v) => set('referencePhotos', v)}
        />
        <p className="small muted" style={{ marginTop: 10, marginBottom: 0 }}>
          Suas proprias fotos tem prioridade: quando voce registra uma ave por foto, ela vira o retrato daquela especie
          na pokedex. A foto da Wikimedia so aparece enquanto voce ainda nao tem a sua, sempre com autor e licenca.
          Sem nenhuma das duas, fica a ilustracao.
        </p>
        {photoCount > 0 && (
          <button
            type="button"
            className="btn btn--ghost btn--block"
            style={{ marginTop: 12 }}
            onClick={async () => {
              await clearStoredPhotos();
              resetPhotoFailures();
              setPhotoCount(0);
            }}
          >
            <TrashIcon />
            Apagar {photoCount} foto{photoCount === 1 ? '' : 's'} baixada{photoCount === 1 ? '' : 's'}
          </button>
        )}
      </div>

      <div className="card">
        <div className="card__title">Pistas de campo</div>
        <p className="small muted">
          Informar onde voce esta quase dobra o acerto da identificacao por canto. O ambiente escolhido aqui ja vem
          marcado a cada gravacao.
        </p>
        <div className="chips">
          {(Object.keys(ENVIRONMENT_LABELS) as Environment[]).map((env) => (
            <button
              key={env}
              type="button"
              className="badge"
              aria-pressed={settings.defaultEnvironment === env}
              style={{
                minHeight: 38,
                padding: '0 13px',
                fontSize: 13,
                background: settings.defaultEnvironment === env ? 'var(--accent-dim)' : 'transparent',
                color: settings.defaultEnvironment === env ? 'var(--accent-strong)' : 'var(--text-muted)',
                borderColor: settings.defaultEnvironment === env ? 'var(--accent)' : 'var(--line-strong)',
              }}
              onClick={() => set('defaultEnvironment', settings.defaultEnvironment === env ? undefined : env)}
            >
              {ENVIRONMENT_LABELS[env]}
            </button>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="card__title">Identificacao assistida por foto</div>
        <Switch
          label="Usar modelo de visao na nuvem"
          hint="Envia a foto para a API da Anthropic e usa a resposta como reforco da analise local."
          checked={settings.cloudEnabled}
          onChange={(v) => set('cloudEnabled', v)}
        />

        {settings.cloudEnabled && (
          <>
            <div className="field" style={{ marginTop: 12 }}>
              <label className="field__label" htmlFor="api-key">
                Chave da API
              </label>
              <input
                id="api-key"
                className="input"
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder="sk-ant-..."
                value={settings.cloudApiKey}
                onChange={(e) => set('cloudApiKey', e.target.value)}
              />
            </div>
            <Notice>
              A chave fica guardada neste navegador e as chamadas saem direto do aparelho. Qualquer extensao com acesso
              a esta pagina consegue le-la, e o uso e cobrado na sua conta. Use uma chave dedicada, com limite de gasto,
              e revogue-a se trocar de aparelho. A identificacao por canto e a analise local de foto continuam
              funcionando offline sem isso.
            </Notice>
          </>
        )}
      </div>

      <div className="card">
        <div className="card__title">Acessibilidade</div>
        <Switch
          label="Texto e botoes maiores"
          hint="Aumenta a fonte e os alvos de toque."
          checked={settings.largeText}
          onChange={(v) => set('largeText', v)}
        />
        <Switch
          label="Reduzir animacoes"
          checked={settings.reduceMotion}
          onChange={(v) => set('reduceMotion', v)}
        />
      </div>

      <div className="card">
        <div className="card__title">Dados</div>
        <p className="small muted">
          {registered} registro{registered === 1 ? '' : 's'} e {photoCount} foto{photoCount === 1 ? '' : 's'} de
          referencia guardad{photoCount === 1 ? 'a' : 'as'} neste aparelho. A analise do canto nunca sai do aparelho.
          Sai da rede apenas: a busca de fotos das especies (envia so o nome cientifico) e, se voce ligar, a
          identificacao assistida por foto.
        </p>
        {confirmClear ? (
          <div className="stack">
            <Notice kind="error">Isso apaga toda a pokedex. Nao da para desfazer.</Notice>
            <button
              type="button"
              className="btn btn--danger btn--block"
              onClick={async () => {
                await clearAll();
                setConfirmClear(false);
                onCleared();
              }}
            >
              Apagar tudo mesmo assim
            </button>
            <button type="button" className="btn btn--ghost btn--block" onClick={() => setConfirmClear(false)}>
              Cancelar
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="btn btn--ghost btn--danger btn--block"
            onClick={() => setConfirmClear(true)}
            disabled={registered === 0}
          >
            <TrashIcon />
            Apagar todos os registros
          </button>
        )}
      </div>

      <div className="card card--flat">
        <div className="card__title">Sobre</div>
        <p className="small muted">
          Ornis identifica aves brasileiras pelo canto e por foto, direto no celular. A analise do canto (FFT,
          espectrograma, extracao de features, comparacao com a base) roda inteira no aparelho, sem internet.
        </p>
        <p className="small muted" style={{ marginBottom: 0 }}>
          A classificacao do tipo de canto e uma inferencia estrutural apoiada em bioacustica: mede frequencia, pureza
          tonal, ritmo, repeticao e melodia e estima qual funcao — territorio, corte, alarme, alimento ou contato — e
          mais compativel com o que foi gravado. E hipotese, nao observacao de comportamento.
        </p>
      </div>
    </div>
  );
}
