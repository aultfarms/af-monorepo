import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { context, initialContext } from './state';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <context.Provider value={initialContext}>
      <App />
    </context.Provider>
  </React.StrictMode>,
);
