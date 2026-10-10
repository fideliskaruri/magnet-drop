import { defineConfig } from 'vite';

// GitHub Pages serves main from /magnet-drop/ and each variant branch from /magnet-drop/<branch>/ (BASE_PATH set by CI).
export default defineConfig(({ command }) => ({
  base: command === 'build' ? (process.env['BASE_PATH'] ?? '/magnet-drop/') : '/',
  server: { host: true, port: 5180 },
  preview: { host: true, port: 5181 },
}));
