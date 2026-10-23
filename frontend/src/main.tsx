import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';
import './theme.css';
import { App } from './ui/App';

createRoot(document.querySelector<HTMLDivElement>('#app')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
