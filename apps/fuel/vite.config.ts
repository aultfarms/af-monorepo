import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/fuel/',
  server: {
    open: true,
    port: 8086,
  },
  build: {
    sourcemap: true,
  },
});
