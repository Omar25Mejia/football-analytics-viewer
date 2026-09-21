import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const API_URL = (process.env.API_FOOTBALL_URL || 'https://v3.football.api-sports.io').replace(/\/$/, '');
const API_KEY = process.env.API_FOOTBALL_KEY || '';

const cache = new Map();
const DEFAULT_TTL = 15 * 60 * 1000;
const CALENDAR_TTL = 30 * 60 * 1000;
const ANALYSIS_TTL = 30 * 60 * 1000;

const LEAGUES = {
  laliga: { id: 140, season: 2026, name: 'LaLiga', country: 'España', flag: '🇪🇸' },
  champions: { id: 2, season: 2026, name: 'Champions League', country: 'Europa', flag: '⭐' },
  bundesliga: { id: 78, season: 2026, name: 'Bundesliga', country: 'Alemania', flag: '🇩🇪' },
  elsalvador: { id: 384, season: 2026, name: 'Primera División', country: 'El Salvador', flag: '🇸🇻' }
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '3600'
};

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon'
};

function send(res, status, body, type='application/json; charset=utf-8', extra={}) {
  res.writeHead(status, { ...corsHeaders, 'Content-Type': type, 'Cache-Control': 'no-store', ...extra });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

function hasApiErrors(data) {
  return data?.errors && ((Array.isArray(data.errors) && data.errors.length) || (!Array.isArray(data.errors) && Object.keys(data.errors).length));
}

function apiErrorMessage(data) {
  if (!hasApiErrors(data)) return '';
  const e = data.errors;
  if (Array.isArray(e)) return e.join(', ');
  return Object.entries(e).map(([k,v]) => `${k}: ${v}`).join(' · ');
}

async function upstream(pathname, ttl=DEFAULT_TTL) {
  if (!API_KEY) throw new Error('API_FOOTBALL_KEY no está configurada en Railway.');
  const target = new URL(pathname.replace(/^\//,''), API_URL + '/');
  const key = target.toString();
  const cached = cache.get(key);
  if (cached && Date.now() - cached.time < ttl) return { data: cached.data, cached: true, headers: cached.headers || {} };

  const response = await fetch(target, {
    headers: { 'x-apisports-key': API_KEY },
    signal: AbortSignal.timeout(12000)
  });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { error: text }; }

  const headers = {
    dailyRemaining: response.headers.get('x-ratelimit-requests-remaining'),
    minuteRemaining: response.headers.get('X-RateLimit-Remaining')
  };

  if (!response.ok) {
    const err = new Error(apiErrorMessage(data) || data?.message || `API-Football HTTP ${response.status}`);
    err.status = response.status;
    err.data = data;
    throw err;
  }
  if (hasApiErrors(data)) {
    const err = new Error(apiErrorMessage(data) || 'API-Football devolvió un error.');
    err.status = 502;
    err.data = data;
    throw err;
  }

  cache.set(key, { time: Date.now(), data, headers });
  return { data, cached: false, headers };
}

function q(params) {
  return new URLSearchParams(params).toString();
}

function seasonForLeague(id) {
  const found = Object.values(LEAGUES).find(x => x.id === Number(id));
  return found?.season || 2026;
}

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value || '');
}

function compactFixture(f) {
  return {
    id: Number(f.fixture?.id),
    date: f.fixture?.date,
    timestamp: f.fixture?.timestamp,
    status: f.fixture?.status || {},
    venue: f.fixture?.venue || {},
    league: f.league || {},
    teams: f.teams || {},
    goals: f.goals || {},
    score: f.score || {}
  };
}

function form(list, teamId) {
  const finished = (list || [])
    .filter(f => ['FT','AET','PEN','P'].includes(f.fixture?.status?.short))
    .sort((a,b) => new Date(b.fixture.date) - new Date(a.fixture.date))
    .slice(0,10);

  let w=0,d=0,l=0,gf=0,ga=0,cs=0,btts=0;
  for (const f of finished) {
    const home = Number(f.teams?.home?.id) === Number(teamId);
    const a = Number(home ? f.goals?.home : f.goals?.away);
    const b = Number(home ? f.goals?.away : f.goals?.home);
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    gf += a; ga += b;
    if (b === 0) cs++;
    if (a > 0 && b > 0) btts++;
    if (a > b) w++; else if (a === b) d++; else l++;
  }
  const n = finished.length;
  return {
    matches:n, wins:w, draws:d, losses:l, goalsFor:gf, goalsAgainst:ga,
    goalsPerGame:n ? +(gf/n).toFixed(2) : null,
    concededPerGame:n ? +(ga/n).toFixed(2) : null,
    cleanSheet:n ? +(cs/n*100).toFixed(0) : null,
    btts:n ? +(btts/n*100).toFixed(0) : null,
    points:n ? w*3+d : null,
    recent:finished.map(compactFixture)
  };
}

function probability(home, away, h2h, prediction) {
  const hp = home.matches ? (home.wins*3 + home.draws) / (home.matches*3) : null;
  const ap = away.matches ? (away.wins*3 + away.draws) / (away.matches*3) : null;
  const ha = home.goalsPerGame, aa = away.goalsPerGame;
  const hd = home.concededPerGame, ad = away.concededPerGame;

  let baseH = 36, baseD = 28, baseA = 36;
  if (hp != null && ap != null) {
    const attackH = Number.isFinite(ha) ? ha : 1;
    const attackA = Number.isFinite(aa) ? aa : 1;
    const defendH = Number.isFinite(hd) ? hd : 1;
    const defendA = Number.isFinite(ad) ? ad : 1;
    const edge = ((hp-ap)*28) + ((attackH-attackA)*8) + ((defendA-defendH)*5);
    baseH += edge;
    baseA -= edge;
  }

  const meetings = (h2h || []).filter(x => ['FT','AET','PEN','P'].includes(x.fixture?.status?.short));
  if (meetings.length) {
    let h=0,d=0,a=0;
    for (const m of meetings.slice(0,10)) {
      const mh=Number(m.teams?.home?.id), ma=Number(m.teams?.away?.id);
      const gh=Number(m.goals?.home), ga=Number(m.goals?.away);
      if (![mh,ma,gh,ga].every(Number.isFinite)) continue;
      if (mh===Number(home.recent[0]?.teams?.home?.id) || ma===Number(home.recent[0]?.teams?.home?.id)) {
        const homeIsMatchHome = mh===Number(home.recent[0]?.teams?.home?.id);
        if (homeIsMatchHome) { if(gh>ga)h++; else if(gh===ga)d++; else a++; }
        else { if(ga>gh)h++; else if(ga===gh)d++; else a++; }
      }
    }
    const n=h+d+a;
    if(n){ baseH += (h/n-.33)*8; baseD += (d/n-.33)*5; baseA += (a/n-.33)*8; }
  }

  const pred = prediction?.percent || {};
  const ph = parseFloat(String(pred.home ?? '').replace('%',''));
  const pd = parseFloat(String(pred.draw ?? '').replace('%',''));
  const pa = parseFloat(String(pred.away ?? '').replace('%',''));
  if ([ph,pd,pa].every(Number.isFinite)) {
    baseH = baseH*.45 + ph*.55;
    baseD = baseD*.45 + pd*.55;
    baseA = baseA*.45 + pa*.55;
  }

  baseH=Math.max(3,baseH); baseD=Math.max(3,baseD); baseA=Math.max(3,baseA);
  const total=baseH+baseD+baseA;
  return { home:+(baseH/total*100).toFixed(1), draw:+(baseD/total*100).toFixed(1), away:+(baseA/total*100).toFixed(1) };
}

async function calendar(req, res, params) {
  const leagueId = Number(params.get('league'));
  const league = Object.values(LEAGUES).find(x => x.id === leagueId);
  const season = Number(params.get('season')) || league?.season || seasonForLeague(leagueId);
  const from = params.get('from'), to = params.get('to');
  if (!leagueId || !validDate(from) || !validDate(to)) return send(res,400,{error:'Calendar requiere league, from y to válidos.'});
  try {
    const {data,headers,cached} = await upstream('/fixtures?'+q({league:leagueId,season,from,to,timezone:'America/El_Salvador'}), CALENDAR_TTL);
    return send(res,200,{league:{id:leagueId,season,name:league?.name||data.response?.[0]?.league?.name||'Liga'},from,to,results:data.results||0,fixtures:(data.response||[]).map(compactFixture),cached,quota:headers.dailyRemaining});
  } catch(e) { return send(res,e.status||502,{error:e.message,api:e.data?.errors||null}); }
}

async function analysis(req,res,params) {
  const fixtureId=Number(params.get('fixture'));
  if(!fixtureId) return send(res,400,{error:'Falta fixture.'});
  try {
    const fx=await upstream('/fixtures?id='+fixtureId, ANALYSIS_TTL);
    const match=fx.data.response?.[0];
    if(!match) return send(res,404,{error:'No se encontró el partido.'});
    const homeId=Number(match.teams?.home?.id), awayId=Number(match.teams?.away?.id), leagueId=Number(match.league?.id), season=Number(match.league?.season)||seasonForLeague(leagueId);

    const [hr,ar,hh,pred,stand] = await Promise.allSettled([
      upstream('/fixtures?'+q({team:homeId,last:10,timezone:'America/El_Salvador'}),ANALYSIS_TTL),
      upstream('/fixtures?'+q({team:awayId,last:10,timezone:'America/El_Salvador'}),ANALYSIS_TTL),
      upstream('/fixtures/headtohead?'+q({h2h:`${homeId}-${awayId}`,last:10,timezone:'America/El_Salvador'}),ANALYSIS_TTL),
      upstream('/predictions?fixture='+fixtureId,ANALYSIS_TTL),
      upstream('/standings?'+q({league:leagueId,season}),ANALYSIS_TTL)
    ]);

    const recentHome=hr.status==='fulfilled' ? hr.value.data.response||[] : [];
    const recentAway=ar.status==='fulfilled' ? ar.value.data.response||[] : [];
    const h2h=hh.status==='fulfilled' ? hh.value.data.response||[] : [];
    const prediction=pred.status==='fulfilled' ? pred.value.data.response?.[0]||null : null;
    const home=form(recentHome,homeId), away=form(recentAway,awayId);
    const probs=probability(home,away,h2h,prediction);
    const hasHistory=home.matches>=3 && away.matches>=3;
    const status=hasHistory ? 'ok' : 'limited';
    const maxKey=probs.home>=probs.draw&&probs.home>=probs.away?'home':probs.away>=probs.home&&probs.away>=probs.draw?'away':'draw';
    const signal=maxKey==='home'?match.teams.home.name:maxKey==='away'?match.teams.away.name:'Empate';
    return send(res,200,{
      fixture:compactFixture(match),
      teams:{home:match.teams.home,away:match.teams.away},
      analysis:{status,confidence:hasHistory?'Alta':'Limitada',probabilities:probs,signal,home,away,h2h:h2h.slice(0,10).map(compactFixture),
        apiPrediction:prediction?{winner:prediction.predictions?.winner||null,advice:prediction.predictions?.advice||null,underOver:prediction.predictions?.under_over||null,goals:prediction.predictions?.goals||null}:null},
      meta:{sources:{recentHome:hr.status,recentAway:ar.status,h2h:hh.status,prediction:pred.status,standings:stand.status},season,leagueId}
    });
  } catch(e) { return send(res,e.status||502,{error:e.message,api:e.data?.errors||null}); }
}

async function proxyApi(req,res) {
  const pathname=req.url.replace(/^\/sports-api/,'') || '/';
  try {
    const {data,headers,cached}=await upstream(pathname,DEFAULT_TTL);
    send(res,200,data,'application/json; charset=utf-8',{
      'X-API-Cache':cached?'HIT':'MISS',
      ...(headers.dailyRemaining?{'X-API-Remaining':headers.dailyRemaining}:{}),
    });
  } catch(e) { send(res,e.status||502,{error:e.message,api:e.data?.errors||null}); }
}

async function serveStatic(req,res) {
  const requested=decodeURIComponent(new URL(req.url,`http://${req.headers.host}`).pathname);
  const relative=requested.replace(/^\/+/, '')||'index.html';
  const safe=path.normalize(relative).replace(/^\.\.(?:[\\/]|$)/,'');
  let filePath=path.join(__dirname,safe);
  try { const stat=await import('node:fs/promises').then(fs=>fs.stat(filePath)); if(!stat.isFile())throw new Error('not file'); } catch { filePath=path.join(__dirname,'index.html'); }
  try { const ext=path.extname(filePath).toLowerCase(); res.writeHead(200,{...corsHeaders,'Content-Type':mime[ext]||'application/octet-stream','Cache-Control':'no-cache'}); createReadStream(filePath).pipe(res); }
  catch { send(res,404,{error:'Not found'}); }
}

const server=http.createServer(async(req,res)=>{
  if(req.method==='OPTIONS'){res.writeHead(200,corsHeaders);res.end();return;}
  if(req.method!=='GET')return send(res,405,{error:'Method not allowed'});
  if(req.url==='/api/health')return send(res,200,{ok:true,service:'football-analytics',apiFootballConfigured:Boolean(API_KEY)});
  if(req.url.startsWith('/sports-api/calendar'))return calendar(req,res,new URL(req.url,`http://${req.headers.host}`).searchParams);
  if(req.url.startsWith('/sports-api/analysis'))return analysis(req,res,new URL(req.url,`http://${req.headers.host}`).searchParams);
  if(req.url.startsWith('/sports-api/'))return proxyApi(req,res);
  return serveStatic(req,res);
});

server.listen(PORT,'0.0.0.0',()=>console.log(`football-analytics listening on ${PORT}`));
