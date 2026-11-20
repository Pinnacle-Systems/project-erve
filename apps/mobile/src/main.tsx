import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { otaService } from './ota/ota-runtime.js';
import './index.css';

async function boot() {
  // Before anything renders: verify this bundle matches the native layer and,
  // at this cold-start safe point only, activate a previously staged OTA
  // bundle. If a reload has started, render nothing — the splash stays up and
  // the new bundle takes over. Never throws and is time-bounded.
  const { reloading } = await otaService.runStartup();
  if (reloading) return;

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void boot();
