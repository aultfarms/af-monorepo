import React from 'react';
import ReactDOM from 'react-dom/client';
import packageJson from '../package.json';
import { App } from './App';
import { context, initialContext } from './state';
import './index.css';
document.title = `AF/Fuel - v${packageJson.version}`;

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <context.Provider value={initialContext}>
      <App />
    </context.Provider>
  </React.StrictMode>,
);
