import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';
import { installAuthGuard } from './auth/session';

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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BootMarker />
    <App />
  </StrictMode>
);
