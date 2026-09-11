import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '')
  const apiKey = env.API_FOOTBALL_KEY
  return {
    plugins: [react()],
    server: {
      proxy: apiKey ? {
        '/sports-api': {
          target: env.API_FOOTBALL_URL || 'https://v3.football.api-sports.io',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/sports-api/, ''),
          headers: { 'x-apisports-key': apiKey },
        },
      } : undefined,
    },
  }
})
