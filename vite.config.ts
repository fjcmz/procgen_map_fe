import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '/procgen_map_fe/',
  plugins: [react()],
  worker: {
    format: 'es',
  },
});
