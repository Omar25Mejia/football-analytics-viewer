import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const API_URL = (process.env.API_FOOTBALL_URL || 'https://v3.football.api-sports.io').replace(/\/$/, '');
const API_KEY = process.env.API_FOOTBALL_KEY || '';
const CACHE_TTL = 15 * 60 * 1000;
const cache = new Map();
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '3600',
};

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
};

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { ...corsHeaders, 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

async function proxyApi(req, res) {
  if (!API_KEY) return send(res, 500, { error: 'API_FOOTBALL_KEY no está configurada en Railway.' });
  const target = new URL(req.url.replace(/^\/sports-api/, ''), `${API_URL}/`);
  const key = target.toString();
  const cached = cache.get(key);
  if (cached && Date.now() - cached.time < CACHE_TTL) return send(res, 200, cached.data);

  try {
    const response = await fetch(target, { headers: { 'x-apisports-key': API_KEY } });
    const text = await response.text();
    if (!response.ok) return send(res, response.status, text);
    let data;
    try { data = JSON.parse(text); } catch { data = text; }
    cache.set(key, { time: Date.now(), data });
    send(res, 200, data);
  } catch (error) {
    send(res, 502, { error: 'No se pudo conectar con API-Football.', detail: error.message });
  }
}

async function serveStatic(req, res) {
  const requested = decodeURIComponent(new URL(req.url, `http://${req.headers.host}`).pathname);
  const relative = requested.replace(/^\/+/, '') || 'index.html';
  const safe = path.normalize(relative).replace(/^\.\.(?:[\\/]|$)/, '');
  let filePath = path.join(__dirname, safe);
  try {
    const stat = await import('node:fs/promises').then(fs => fs.stat(filePath));
    if (!stat.isFile()) throw new Error('not file');
  } catch {
    filePath = path.join(__dirname, 'index.html');
  }
  try {
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { ...corsHeaders, 'Content-Type': mime[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    createReadStream(filePath).pipe(res);
  } catch {
    send(res, 404, { error: 'Not found' });
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    if (req.url.startsWith('/api/') || req.url.startsWith('/sports-api/')) {
      res.writeHead(200, corsHeaders);
      res.end();
      return;
    }
  }
  if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed' });
  if (req.url === '/api/health') return send(res, 200, { ok: true, service: 'football-analytics', apiFootballConfigured: Boolean(API_KEY) });
  if (req.url.startsWith('/sports-api/')) return proxyApi(req, res);
  return serveStatic(req, res);
});

server.listen(PORT, '0.0.0.0', () => console.log(`football-analytics listening on ${PORT}`));
