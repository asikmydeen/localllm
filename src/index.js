import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import reportWebVitals from './reportWebVitals';
import { registerServiceWorker } from './utils/serviceWorkerRegistration';

// Register service worker for production builds
if (process.env.NODE_ENV === 'production') {
  registerServiceWorker()
    .then(registration => {
      console.log('Service worker registered successfully:', registration);
    })
    .catch(error => {
      console.error('Service worker registration failed:', error);
    });
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Measure performance with Web Vitals
reportWebVitals(console.log);
