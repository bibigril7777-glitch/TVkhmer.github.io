// Server.js — Node.js 18+ (no npm packages needed)
// Run:  node Server.js     Open: http://localhost:3000
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ---- Secret API key: environment variable API_KEY, or secrets.js (never sent to browsers) ----
let API_KEY = process.env.API_KEY || '';
if (!API_KEY) { try { API_KEY = String(require('./secrets.js').API_KEY || '').trim(); } catch (e) {} }
// Use apiFetch(url, options) for server-side calls to the service this key belongs to.
// Second key (API_KEY_2): environment variable or secrets.js
let API_KEY_2 = process.env.API_KEY_2 || '';
if (!API_KEY_2) { try { API_KEY_2 = String(require('./secrets.js').API_KEY_2 || '').trim(); } catch (e) {} }
const apiKeyOf = which => (which === 2 || which === 'secondary') ? API_KEY_2 : API_KEY;
const apiHeaders = (extra = {}, which = 1) => ({ ...(apiKeyOf(which) ? { Authorization: `Bearer ${apiKeyOf(which)}` } : {}), ...extra });
// apiFetch(url, options, which): which = 1 (API_KEY, default) or 2 (API_KEY_2)
const apiFetch = (url, opts = {}, which = 1) => fetch(url, { ...opts, headers: apiHeaders(opts.headers, which) });

const PORT = process.env.PORT || 3000;
const BASE = 'https://iptv-org.github.io/iptv';

// name -> country/language code on iptv-org
const PL = { cambodia:'kh', myanmar:'mm', indian:'in', chinese:'cn', taiwan:'tw', indonesia:'id', russian:'ru', philippines:'ph', malaysian:'my', japanese:'jp', america:'us', spain:'es', ukraine:'ua', iran:'ir', iraq:'iq', qatar:'qa', vietnam:'vn', laos:'la', singapore:'sg', southkorea:'kr', northkorea:'kp', syria:'sy', southafrica:'za', israel:'il', sweden:'se', english:'eng' };

const cache = new Map(); // name -> { time, body }
const TTL = 30 * 60 * 1000; // 30 minutes

async function getPlaylist(name) {
  const hit = cache.get(name);
  if (hit && Date.now() - hit.time < TTL) return hit.body;
  const r = await fetch(`${BASE}/${name === 'english' ? 'languages' : 'countries'}/${PL[name]}.m3u`);
  if (!r.ok) throw new Error('Upstream ' + r.status);
  const body = await r.text();
  cache.set(name, { time: Date.now(), body });
  return body;
}

// ---- Shared station data (so every device sees the same schedule) ----
const D = process.env.DATA_DIR || path.join(__dirname, 'data'), MD = path.join(D, 'media'), PUB = path.join(D, 'pub.json'), KF = path.join(D, 'key.txt');
fs.mkdirSync(MD, { recursive: true });
let KEY = process.env.PUBLISH_KEY || (fs.existsSync(KF) ? fs.readFileSync(KF, 'utf8').trim() : '');
if (!KEY) { KEY = crypto.randomBytes(6).toString('hex'); fs.writeFileSync(KF, KEY); }
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type, x-key', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
const MIME = { mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' };
const fails = new Map();
const readPub = () => { try { return JSON.parse(fs.readFileSync(PUB, 'utf8')); } catch (e) { return {}; } };
function keyOk(req) {
  const ip = req.socket.remoteAddress, f = fails.get(ip) || { n: 0, t: Date.now() };
  if (Date.now() - f.t > 6e5) { f.n = 0; f.t = Date.now(); }
  const k = Buffer.from(String(req.headers['x-key'] || '')), K = Buffer.from(KEY);
  const ok = k.length === K.length && crypto.timingSafeEqual(k, K);
  if (!ok) { f.n++; fails.set(ip, f); }
  return ok && f.n < 10;
}
const readBody = (req, max) => new Promise(r => { let s = '', big = false;
  req.on('data', c => { s += c; if (s.length > max) { big = true; req.destroy(); } });
  req.on('end', () => { try { r(big ? {} : JSON.parse(s || '{}')); } catch (e) { r({}); } }); });
// ---- Live chat for viewers (polling API). Members-only when name.js has names; admin = publish key ----
const CHATF = path.join(D, 'chat.json');
let chat = [], chatId = 0;
try { chat = JSON.parse(fs.readFileSync(CHATF, 'utf8')); chatId = chat.reduce((m, x) => Math.max(m, x.id), 0); } catch (e) { chat = []; }
const saveChat = () => fs.writeFile(CHATF, JSON.stringify(chat), () => {});
const chatRate = new Map();
const cleanTxt = (v, n) => String(v || '').replace(/[\u0000-\u001F\u007F\u200B-\u200D\uFEFF]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
function allowedNames() {
  for (const f of [path.join(D, 'site', 'name.js'), path.join(__dirname, 'name.js')]) {
    try { const m = /window\.TV_NAMES\s*=\s*(\[[\s\S]*?\])\s*;/.exec(fs.readFileSync(f, 'utf8')); if (m) return JSON.parse(m[1]).map(x => String(x).trim().toLowerCase()).filter(Boolean); } catch (e) {}
  }
  return [];
}
function media(req, res, f) {
  const p = path.join(MD, path.basename(f));
  fs.stat(p, (e, st) => {
    if (e) return send(res, 404, 'text/plain', 'not found');
    let a = 0, z = st.size - 1, code = 200;
    const h = { 'Content-Type': MIME[path.extname(f).slice(1).toLowerCase()] || 'application/octet-stream', 'Accept-Ranges': 'bytes', ...CORS };
    const m = (req.headers.range || '').match(/bytes=(\d*)-(\d*)/);
    if (m && (m[1] || m[2])) {
      if (m[1]) { a = +m[1]; if (m[2]) z = Math.min(+m[2], z); } else a = Math.max(0, st.size - +m[2]);
      if (a > z) { res.writeHead(416); return res.end(); }
      code = 206; h['Content-Range'] = `bytes ${a}-${z}/${st.size}`;
    }
    h['Content-Length'] = z - a + 1; res.writeHead(code, h);
    fs.createReadStream(p, { start: a, end: z }).pipe(res);
  });
}

function send(res, code, type, body) {
  res.writeHead(code, { 'Content-Type': type, ...CORS });
  res.end(body);
}

// Optional HTTPS (set TLS_KEY and TLS_CERT). Most hosts already provide HTTPS in front of this server.
const mkServer = h => process.env.TLS_KEY && process.env.TLS_CERT
  ? require('https').createServer({ key: fs.readFileSync(process.env.TLS_KEY), cert: fs.readFileSync(process.env.TLS_CERT) }, h)
  : http.createServer(h);
mkServer(async (req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  try {
    if (p === '/healthz') return send(res, 200, 'text/plain', 'ok');
    if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }
    if (p === '/api/public') return send(res, 200, 'application/json', JSON.stringify(readPub()));
    let mm;
    if ((mm = p.match(/^\/media\/([\w.-]+)$/))) return media(req, res, mm[1]);
    if (p === '/api/media' && req.method === 'POST') { // admin upload (needs publish key)
      if (!keyOk(req)) return send(res, 401, 'application/json', '{"error":"key"}');
      const name = (new URL(req.url, 'http://x').searchParams.get('name') || 'file').slice(0, 100);
      const ext = (path.extname(name).slice(1).toLowerCase().match(/^\w{1,5}$/) || [''])[0];
      const ct = String(req.headers['content-type'] || '');
      if (!(ct.startsWith('video/') || ct.startsWith('image/') || MIME[ext])) return send(res, 400, 'application/json', '{"error":"type"}');
      const id = crypto.randomUUID() + (ext ? '.' + ext : ''), ws = fs.createWriteStream(path.join(MD, id));
      req.pipe(ws);
      ws.on('finish', () => send(res, 200, 'application/json', JSON.stringify({ id })));
      ws.on('error', () => send(res, 500, 'application/json', '{"error":"write"}'));
      return;
    }
    if (p === '/api/publish' && req.method === 'POST') { // admin publishes schedule + settings
      if (!keyOk(req)) return send(res, 401, 'application/json', '{"error":"key"}');
      const b = await readBody(req, 12e6), okId = f => typeof f === 'string' && /^[\w.-]+$/.test(f) && fs.existsSync(path.join(MD, f));
      const schedule = (Array.isArray(b.schedule) ? b.schedule : []).slice(0, 500).map(x => ({
        day: Math.max(0, Math.min(6, +x.day || 0)), time: /^\d{2}:\d{2}$/.test(x.time) ? x.time : '00:00', title: String(x.title || '').slice(0, 120),
        type: ['vid', 'img', 'yt'].includes(x.type) ? x.type : 'vid', file: okId(x.file) ? x.file : '', yt: /^[\w-]{11}$/.test(x.yt || '') ? x.yt : '', ytdur: Math.max(5, +x.ytdur || 60) }))
        .filter(x => x.type === 'yt' ? x.yt : x.file);
      const ads = (Array.isArray(b.ads) ? b.ads : []).slice(0, 100).filter(okId);
      const files = {}; Object.entries(b.files || {}).forEach(([k, v]) => { if (okId(v)) files[String(k).slice(0, 200)] = v; });
      const settings = {}; ['logo', 'ovl', 'txt', 'txt2', 'sz1', 'sz2', 'spd', 'clk', 'ltxt'].forEach(k => { settings[k] = String((b.settings || {})[k] || '').slice(0, 3e6); });
      fs.writeFileSync(PUB, JSON.stringify({ ver: Date.now(), settings, schedule, ads, files }));
      const used = new Set([...schedule.map(x => x.file), ...ads]);
      fs.readdirSync(MD).forEach(f => { if (!used.has(f)) fs.unlink(path.join(MD, f), () => {}); });
      return send(res, 200, 'application/json', JSON.stringify({ ok: true, count: schedule.length }));
    }
    if (p === '/api/site' && req.method === 'POST') { // admin publishes schedule.json + logo.png in one request
      if (!keyOk(req)) return send(res, 401, 'application/json', '{"error":"key"}');
      const b = await readBody(req, 6e6), cfg = b.cfg || {};
      const okUrl = u => typeof u === 'string' && u.length < 3e6 && !u.includes('..') && (/^https?:\/\/[^\s"'<>]+$/i.test(u) || /^[\w\-./]+$/.test(u) || /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(u));
      const schedule = (Array.isArray(cfg.schedule) ? cfg.schedule : []).slice(0, 500).map(x => {
        const e = { day: Math.max(0, Math.min(6, +x.day || 0)), time: /^\d{2}:\d{2}$/.test(x.time) ? x.time : '00:00', title: String(x.title || '').slice(0, 120), type: ['vid', 'img', 'yt'].includes(x.type) ? x.type : 'vid' };
        if (e.type === 'yt') { e.yt = /^[\w-]{11}$/.test(x.yt || '') ? x.yt : ''; e.ytdur = Math.max(5, +x.ytdur || 60); } else e.url = okUrl(x.url) ? x.url : '';
        return e;
      }).filter(e => e.type === 'yt' ? e.yt : e.url);
      const settings = {}; ['txt', 'txt2', 'sz1', 'sz2', 'spd', 'clk', 'ltxt'].forEach(k => { settings[k] = String((cfg.settings || {})[k] || '').slice(0, 1000); });
      const nt = (cfg.settings || {}).notice; if (nt && typeof nt === 'object' && String(nt.text || '').trim()) settings.notice = { id: +nt.id || Date.now(), text: cleanTxt(nt.text, 300) };
      const lg = String((cfg.settings || {}).logo || ''); settings.logo = lg === '' || okUrl(lg) ? lg : '';
      const ov = String((cfg.settings || {}).ovl || ''); settings.ovl = ov === '' || okUrl(ov) ? ov : '';
      const ads = (Array.isArray(cfg.ads) ? cfg.ads : []).slice(0, 100).filter(okUrl);
      fs.mkdirSync(path.join(D, 'site'), { recursive: true });
      let logoSaved = false;
      const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(b.logo || ''));
      if (m) { const buf = Buffer.from(m[1], 'base64'); if (buf.length < 3e6 && buf.slice(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))) { fs.writeFileSync(path.join(D, 'site', 'logo.png'), buf); logoSaved = true; } }
      else if (b.logo) return send(res, 400, 'application/json', '{"error":"logo must be a PNG data URL"}');
      if (settings.logo === 'logo.png' && !fs.existsSync(path.join(D, 'site', 'logo.png')) && !fs.existsSync(path.join(__dirname, 'logo.png'))) settings.logo = '';
      let names = null, games = null;
      if (Array.isArray(b.names)) { names = [...new Set(b.names.map(x => String(x).trim()).filter(x => x && x.length <= 40))].slice(0, 2000); fs.writeFileSync(path.join(D, 'site', 'name.js'), 'window.TV_NAMES=' + JSON.stringify(names) + ';\n'); }
      if (Array.isArray(b.games)) { games = b.games.filter(g => g && typeof g.t === 'string' && /^https?:\/\/[^\s"'<>]+\.apk([?#][^\s"'<>]*)?$/i.test(String(g.u))).slice(0, 100).map(g => ({ t: g.t.slice(0, 60), u: String(g.u) })); fs.writeFileSync(path.join(D, 'site', 'Game.js'), 'window.TV_GAMES=' + JSON.stringify(games) + ';\n'); }
      fs.writeFileSync(path.join(D, 'site', 'schedule.json'), JSON.stringify({ ver: Date.now(), settings, schedule, ads }));
      return send(res, 200, 'application/json', JSON.stringify({ ok: true, count: schedule.length, logo: logoSaved, names: names && names.length, games: games && games.length }));
    }
    if (p === '/api/key-status' && req.method === 'GET') { // admin check only; the key itself is never returned
      if (!keyOk(req)) return send(res, 401, 'application/json', '{"error":"key"}');
      return send(res, 200, 'application/json', JSON.stringify({ configured: !!API_KEY, length: API_KEY.length, key2: { configured: !!API_KEY_2, length: API_KEY_2.length } }));
    }
    if (p === '/api/chat' && req.method === 'GET') {
      const after = +new URL(req.url, 'http://x').searchParams.get('after') || 0;
      return send(res, 200, 'application/json', JSON.stringify({ ok: true, last: chatId, msgs: chat.filter(x => x.id > after).slice(-100) }));
    }
    if (p === '/api/chat' && req.method === 'POST') {
      const b = await readBody(req, 4e3), hasKey = !!req.headers['x-key'];
      if (hasKey && !keyOk(req)) return send(res, 401, 'application/json', '{"error":"key"}');
      const text = cleanTxt(b.text, 300); if (!text) return send(res, 400, 'application/json', '{"error":"text"}');
      let name = 'admin';
      if (!hasKey) {
        name = cleanTxt(b.name, 40);
        if (name.length < 2 || /^(📢\s*)?admin$/i.test(name)) return send(res, 400, 'application/json', '{"error":"name"}');
        const al = allowedNames(); if (al.length && !al.includes(name.toLowerCase())) return send(res, 403, 'application/json', '{"error":"not allowed"}');
        const ip = req.socket.remoteAddress, now = Date.now(), arr = (chatRate.get(ip) || []).filter(t => now - t < 60000);
        if (arr.length >= 20 || (arr.length && now - arr[arr.length - 1] < 1500)) return send(res, 429, 'application/json', '{"error":"slow down"}');
        arr.push(now); chatRate.set(ip, arr);
      }
      const msg = { id: ++chatId, t: Date.now(), n: name, m: text, ...(hasKey && b.ann ? { a: 1 } : {}) };
      chat.push(msg); if (chat.length > 200) chat = chat.slice(-200); saveChat();
      return send(res, 200, 'application/json', JSON.stringify({ ok: true, id: msg.id }));
    }
    if (p === '/api/chat/delete' && req.method === 'POST') {
      if (!keyOk(req)) return send(res, 401, 'application/json', '{"error":"key"}');
      const b = await readBody(req, 1e3); chat = chat.filter(x => x.id !== +b.id); saveChat();
      return send(res, 200, 'application/json', '{"ok":true}');
    }
    if (p === '/api/playlists') return send(res, 200, 'application/json', JSON.stringify(Object.keys(PL)));
    const m = p.match(/^\/playlist\/([a-z]+)\.m3u8?$/i);
    if (m) {
      const name = m[1].toLowerCase();
      if (!PL[name]) return send(res, 404, 'text/plain', 'Unknown playlist');
      return send(res, 200, 'application/vnd.apple.mpegurl; charset=utf-8', await getPlaylist(name));
    }
    if (['/name.js', '/Game.js', '/schedule.json', '/logo.png'].includes(p)) { // files published by admin (data/site) win over files next to Server.js
      const f = [path.join(D, 'site', p.slice(1)), path.join(__dirname, p.slice(1))].find(x => fs.existsSync(x));
      const ct = p.endsWith('.json') ? 'application/json' : p.endsWith('.png') ? 'image/png' : 'text/javascript; charset=utf-8';
      return f ? send(res, 200, ct, fs.readFileSync(f)) : send(res, 404, 'text/plain', 'not found');
    }
    if (p === '/' || p === '/index.html')
      return send(res, 200, 'text/html; charset=utf-8', fs.readFileSync(path.join(__dirname, 'index.html')));
    send(res, 404, 'text/plain', 'Not found');
  } catch (e) {
    send(res, 502, 'text/plain', 'Error: ' + e.message);
  }
}).listen(PORT, () => {
  console.log(`TV server running: http://localhost:${PORT}`);
  console.log(API_KEY ? 'API key: configured (hidden)' : 'API key: not set (use API_KEY env var or secrets.js)');
  console.log(API_KEY_2 ? 'API key 2: configured (hidden)' : 'API key 2: not set (use API_KEY_2 env var or secrets.js)');
  console.log(process.env.PUBLISH_KEY ? 'Publish key: (from PUBLISH_KEY environment variable)' : `Publish key (enter it once in the admin panel): ${KEY}`);
  const lan = Object.values(require('os').networkInterfaces()).flat().filter(n => n && n.family === 'IPv4' && !n.internal).map(n => `http://${n.address}:${PORT}`);
  console.log('Open on phone / other devices (same Wi-Fi): ' + (lan.join('   ') || '(no network found)'));
  console.log('Playlists: ' + Object.keys(PL).map(k => `/playlist/${k}.m3u8`).join('  '));
});

// ---- HTTP/2 example server (cleartext, trailers demo) ----
const http2 = require('node:http2');
const server = http2.createServer();
server.on('stream', (stream) => {
  stream.respond(undefined, { waitForTrailers: true });
  stream.on('wantTrailers', () => {
    stream.sendTrailers({ xyz: 'abc' });
  });
  stream.end('Hello World');
});
const H2PORT = process.env.H2_PORT || 3001;
server.on('error', e => console.log('HTTP/2 demo server not started:', e.message));
// On a hosting platform (PORT is set) the HTTP/2 demo is off unless H2_PORT is given.
if (!process.env.PORT || process.env.H2_PORT) server.listen(H2PORT, () => console.log('HTTP/2 server: http://localhost:' + H2PORT));
