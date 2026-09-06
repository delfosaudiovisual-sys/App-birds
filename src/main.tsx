import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/app.css';

const container = document.getElementById('root');
if (!container) throw new Error('Elemento #root nao encontrado.');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

/**
 * Pede armazenamento persistente.
 *
 * Importa muito no iPhone: o Safari apaga os dados de um site que fica sete
 * dias sem ser aberto. Sem isso, uma pokedex construida ao longo de meses some
 * depois de uma semana de ferias. Instalar pela Tela de Inicio ja ajuda, e a
 * concessao explicita ajuda mais.
 */
if (navigator.storage?.persist) {
  void navigator.storage.persisted().then((already) => {
    if (!already) return navigator.storage.persist();
  }).catch(() => {
    // navegador sem a API: segue sem garantia
  });
}

// Service worker: o app precisa abrir no mato, sem sinal.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    try {
      // Aberto de file:// nao ha service worker possivel; o try evita que a
      // construcao da URL derrube a inicializacao do app.
      if (window.location.protocol === 'file:') return;
      const url = new URL('sw.js', document.baseURI).href;
      void navigator.serviceWorker.register(url).catch(() => {
        // sem service worker o app ainda funciona, so nao abre offline
      });
    } catch {
      // idem
    }
  });
}
