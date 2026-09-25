import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import './ui/tokens.css';
import './ui/primitives.css';
import './index.css';
import App from './App.tsx';
import './ui/controls.css';
import { installAuthGuard } from './auth/session';
import { ClientErrorBoundary } from './observability/ClientErrorBoundary';
import {
  installClientErrorReporting,
  reportClientError,
} from './observability/client-error-reporter';

declare global {
  interface Window {
    __unleashdBoot?: {
      fail: (message: string) => void;
      ready: () => void;
    };
  }
}

function BootMarker() {
  useEffect(() => {
    window.__unleashdBoot?.ready();
  }, []);

  return null;
}

// Before React mounts: a 401 from any request now lands on the login page
// rather than leaving an empty shell behind.
installAuthGuard();
installClientErrorReporting();

// Routes are lazy chunks (App.tsx). A tab opened before a rebuild asks for
// chunk names that no longer exist; reload once to pick up the new
// index.html. A second failure within a minute surfaces as a normal error.
const CHUNK_RELOAD_KEY = 'unleashd:chunk-reload-at';
window.addEventListener('vite:preloadError', (event) => {
  try {
    const last = Number(sessionStorage.getItem(CHUNK_RELOAD_KEY) ?? 0);
    if (Date.now() - last < 60_000) return;
    sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now()));
  } catch {
    return;
  }
  event.preventDefault();
  window.location.reload();
});

createRoot(document.getElementById('root')!, {
  onUncaughtError: (error, info) => {
    reportClientError({
      source: 'react-uncaught',
      error,
      componentStack: info.componentStack,
    });
  },
  onRecoverableError: (error, info) => {
    reportClientError({
      source: 'react-recoverable',
      error,
      componentStack: info.componentStack,
    });
  },
}).render(
  <StrictMode>
    <ClientErrorBoundary>
      <BootMarker />
      <App />
    </ClientErrorBoundary>
  </StrictMode>
);
