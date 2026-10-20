import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const apiTarget = env.VITE_API_PROXY_TARGET || 'http://127.0.0.1:3000';
  return {
    plugins: [react()],
    server: {
      allowedHosts: ['apk_platform.doduy.site'],
      proxy: {
        '/api': { target: apiTarget, changeOrigin: true },
        '/downloads': { target: apiTarget, changeOrigin: true },
      },
    },
    test: { environment: 'jsdom', setupFiles: ['./src/test-setup.ts'], include: ['src/**/*.test.{ts,tsx}'] },
  };
});
