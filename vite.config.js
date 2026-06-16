import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig(({ command, mode }) => ({
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'src/index.html'),
        ami: resolve(__dirname, 'src/ami.html'),
        financials: resolve(__dirname, 'src/financials.html'),
        beta: resolve(__dirname, 'src/beta.html'),
        platlang: resolve(__dirname, 'src/platlang.html'),
        addons: resolve(__dirname, 'src/addons.html'),
        version: resolve(__dirname, 'src/version.html'),
        telemetry: resolve(__dirname, 'src/telemetry.html'),
      },
    },
  },
  root: 'src/',
}));
