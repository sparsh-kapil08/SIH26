import { defineConfig } from 'vite';
import { resolve } from 'path';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';

function copyFrontendScripts() {
  return {
    name: 'copy-frontend-scripts',
    closeBundle() {
      const sourceDir = resolve(__dirname, 'js');
      const outputDir = resolve(__dirname, 'dist/js');
      if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });
      cpSync(sourceDir, outputDir, { recursive: true });

      const configPath = resolve(outputDir, 'config.js');
      const configSource = readFileSync(configPath, 'utf8');
      const buildEnv = JSON.stringify({
        VITE_BACKEND_URL: process.env.VITE_BACKEND_URL || 'http://localhost:5000',
        VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL || '',
        VITE_SUPABASE_ANON_KEY: process.env.VITE_SUPABASE_ANON_KEY || ''
      });
      writeFileSync(configPath, configSource.replace(
        "const env = { VITE_BACKEND_URL: 'http://localhost:5000' };",
        `const env = ${buildEnv};`
      ));
    }
  };
}

export default defineConfig({
  root: '.',
  plugins: [copyFrontendScripts()],
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
