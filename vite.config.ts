import { defineConfig } from 'vite';

// GitHub Pages serves the site from /magnet-drop/.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/magnet-drop/' : '/',
  server: { host: true, port: 5180 },
  preview: { host: true, port: 5181 },
}));
