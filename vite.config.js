import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'client',
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      // changeOrigin: false préserve le Host original (localhost:5173) au
      // lieu de le réécrire vers la cible (localhost:3000) : le contrôle
      // anti-CSRF du backend (server/app.js) compare Origin à Host et
      // rejetait sinon à tort toute requête de modification passée par ce
      // proxy de développement (Origin=5173 != Host=3000 après réécriture).
      '/api': { target: 'http://localhost:3000', changeOrigin: false },
    },
  },
});
