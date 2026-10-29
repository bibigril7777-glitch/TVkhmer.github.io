// Server.js — Node.js 18+ (no npm packages needed)
// Run:  node Server.js     Open: http://localhost:3000
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

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
    if (p === '/api/playlists') return send(res, 200, 'application/json', JSON.stringify(Object.keys(PL)));
    const m = p.match(/^\/playlist\/([a-z]+)\.m3u8?$/i);
    if (m) {
      const name = m[1].toLowerCase();
      if (!PL[name]) return send(res, 404, 'text/plain', 'Unknown playlist');
      return send(res, 200, 'application/vnd.apple.mpegurl; charset=utf-8', await getPlaylist(name));
    }
    if (['/name.js', '/Game.js', '/schedule.json'].includes(p)) {
      const f = path.join(__dirname, p.slice(1));
      return fs.existsSync(f) ? send(res, 200, p.endsWith('.json') ? 'application/json' : 'text/javascript; charset=utf-8', fs.readFileSync(f)) : send(res, 404, 'text/plain', 'not found');
    }
    if (p === '/' || p === '/index.html')
      return send(res, 200, 'text/html; charset=utf-8', fs.readFileSync(path.join(__dirname, 'index.html')));
    send(res, 404, 'text/plain', 'Not found');
  } catch (e) {
    send(res, 502, 'text/plain', 'Error: ' + e.message);
  }
}).listen(PORT, () => {
  console.log(`TV server running: http://localhost:${PORT}`);
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
