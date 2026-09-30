import { defineConfig } from 'vite';
import path from 'node:path';

export default defineConfig({
  root: path.resolve('apps/workbench'),
  build: { outDir: path.resolve('dist'), emptyOutDir: true },
  server: { host: '127.0.0.1' },
});
