import { viteSingleFile } from 'vite-plugin-singlefile';
import { defineConfig } from 'vite';

export default defineConfig({
  base: '',
  server: {
    host: '::',
    port: 8080,
    hmr: false,
  },
  plugins: [viteSingleFile()],
});
