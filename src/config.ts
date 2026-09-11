const envMode = import.meta.env.VITE_DATA_MODE
export const appConfig = {
  dataMode: envMode === 'api-football' ? 'api-football' : 'demo',
  liveRefreshMs: Math.max(30_000, Number(import.meta.env.VITE_LIVE_REFRESH_MS) || 900_000),
  timezone: import.meta.env.VITE_TIMEZONE || 'America/El_Salvador',
  analysisHistoryMatches: Math.min(10, Math.max(5, Number(import.meta.env.VITE_ANALYSIS_HISTORY_MATCHES) || 10)),
  modelWeights: { recentForm: 0.25, homeAway: 0.20, attack: 0.15, defence: 0.15, headToHead: 0.10, providerModel: 0.15 },
} as const
