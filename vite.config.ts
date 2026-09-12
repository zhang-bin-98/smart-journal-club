import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { pwaPlugin } from './scripts/pwa';

export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss(), pwaPlugin()],
  server: { watch: { ignored: ['**/output/**'] } },
  build: { target: 'es2022' }
});
