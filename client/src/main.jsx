import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.jsx';

// Browsers step a focused <input type="number"> when the mouse wheel scrolls
// over it — easy to nudge a price, quantity or tax rate without noticing.
// Blur it instead, so the wheel scrolls the page and the value stays put.
document.addEventListener('wheel', () => {
  const el = document.activeElement;
  if (el instanceof HTMLInputElement && el.type === 'number') el.blur();
}, { passive: true });

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
);
