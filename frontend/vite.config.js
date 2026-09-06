import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: '.',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        login: resolve(__dirname, 'login.html'),
        dashboard: resolve(__dirname, 'dashboard.html'),
        scan: resolve(__dirname, 'scan.html'),
        report: resolve(__dirname, 'report.html')
      }
    }
  },
  server: {
    port: 3000
  }
});
