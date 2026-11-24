import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { applyTheme, getSettings } from './lib/settings';
import { initSnapshotScheduler } from './db/snapshots';
import './index.css';

applyTheme(getSettings().theme);
initSnapshotScheduler();
// Облачные модули — отдельными чанками и только при наличии ключей:
// офлайн-ядро не должно тяжелеть из-за Supabase/Google.
if (import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY) {
  void import('./sync/engine').then((module) => module.initSync());
}
if (import.meta.env.VITE_GOOGLE_CLIENT_ID) {
  void import('./drive/backup').then((module) => module.initDrive());
}

const container = document.getElementById('root');
if (!container) throw new Error('Не найден корневой элемент #root');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
