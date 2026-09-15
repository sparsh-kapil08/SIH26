import { defineConfig, loadEnv } from 'vite';
import { resolve } from 'path';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';

function copyFrontendScripts(mode) {
  const env = loadEnv(mode, __dirname, '');
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
        VITE_BACKEND_URL: env.VITE_BACKEND_URL || '',
        VITE_SUPABASE_URL: env.VITE_SUPABASE_URL || '',
        VITE_SUPABASE_ANON_KEY: env.VITE_SUPABASE_ANON_KEY || ''
      });
      writeFileSync(configPath, configSource.replace(
        "const env = { VITE_BACKEND_URL: '' };",
        `const env = ${buildEnv};`
      ));
    }
  };
}

export default defineConfig(({ mode }) => ({
  root: '.',
  plugins: [copyFrontendScripts(mode)],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        login: resolve(__dirname, 'login.html'),
        dashboard: resolve(__dirname, 'dashboard.html'),
        scan: resolve(__dirname, 'scan.html'),
        report: resolve(__dirname, 'report.html'),
        adminRules: resolve(__dirname, 'admin-rules.html')
      }
    }
  },
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: process.env.VITE_DEV_BACKEND_URL || 'http://localhost:5000',
        changeOrigin: true
      }
    }
  }
}));
