import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import './style.css';
import { initializeStorageSession } from './app/composition';
import { StorageResetPage } from './ui/settings/StorageResetPage';

void initializeStorageSession().then(() => {
  const resetting = new URLSearchParams(location.search).get('smartjc-reset-storage') === '1';
  createRoot(document.getElementById('app')!).render(
    <StrictMode>{resetting ? <StorageResetPage /> : <App />}</StrictMode>,
  );
});
