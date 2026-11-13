import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { startAnalytics } from './services/analytics';
import { capturePaymentReturn, captureShareLink } from './services/account';
import { captureSource } from './services/insight';

// First, so the key of a share link never ends up in the page-view statistics.
captureShareLink();
capturePaymentReturn();
captureSource();
startAnalytics();

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);