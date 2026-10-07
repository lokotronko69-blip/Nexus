import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  const rawKey = (env.GEMINI_API_KEY || process.env.GEMINI_API_KEY || '').trim();
  const isPlaceholder =
    !rawKey ||
    rawKey === 'MY_GEMINI_API_KEY' ||
    rawKey === 'GEMINI_API_KEY' ||
    rawKey === 'API_KEY' ||
    rawKey === 'YOUR_API_KEY' ||
    rawKey === 'TU_CLAVE_GEMINI_AQUI' ||
    rawKey === 'TU_CLAVE_AQUI';
  return {
    define: {
      'process.env.API_KEY': JSON.stringify(isPlaceholder ? '' : rawKey),
      'process.env.GEMINI_API_KEY': JSON.stringify(isPlaceholder ? '' : rawKey),
    },
    server: {
      port: 3000,
      host: '0.0.0.0',
      hmr: false,
    },
    plugins: [
      react(),
      tailwindcss(),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      }
    }
  };
});
