import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [ react() ],
  base: '/field-work',
  server: {
    open: true,
  },
  build: {
    sourcemap: true,
  },
});
