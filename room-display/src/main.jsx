import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import { startThemeWatcher } from './theme';
import { bootstrapKiosk } from './kiosk';
import './index.css';

bootstrapKiosk(); // seed roomId/displayToken from the wrapper's launch URL before React reads localStorage
startThemeWatcher();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
