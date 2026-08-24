import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { installDialogBehavior } from './dialogBehavior';
import { installStatusPresentation } from './statusPresentation';
import './styles.css';
import './integration.css';
import './ux.css';
import './devicePolish.css';
import './accessibility.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

installDialogBehavior();
installStatusPresentation();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => undefined);
  });
}
