import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
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
