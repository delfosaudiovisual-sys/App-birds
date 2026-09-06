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

// Service worker: o app precisa abrir no mato, sem sinal.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    const url = new URL('sw.js', document.baseURI).href;
    navigator.serviceWorker.register(url).catch(() => {
      // sem service worker o app ainda funciona, so nao abre offline
    });
  });
}
