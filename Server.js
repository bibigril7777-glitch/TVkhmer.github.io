// Server.js — Node.js 18+, no npm packages.  Run: node Server.js  → http://localhost:3000
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const PORT = process.env.PORT || 3000;
const ADMIN = process.env.ADMIN_NAME || 'phengchen888'; // admin name (never sent to the browser)
const D = path.join(__dirname, 'data'), M = path.join(D, 'media'), DBF = path.join(D, 'db.json'), B = path.join(__dirname, 'backups');
fs.mkdirSync(M, { recursive: true }); fs.mkdirSync(B, { recursive: true });

// ---- IPTV playlists ----
const BASE = 'https://iptv-org.github.io/iptv';
const PL = { cambodia:'kh', myanmar:'mm', indian:'in', chinese:'cn', taiwan:'tw', indonesia:'id', russian:'ru', philippines:'ph', malaysian:'my', japanese:'jp', america:'us', spain:'es', ukraine:'ua', iran:'ir', iraq:'iq', qatar:'qa', vietnam:'vn', laos:'la', singapore:'sg', southkorea:'kr', northkorea:'kp', syria:'sy', southafrica:'za', israel:'il', sweden:'se', english:'eng' };
const cache = new Map();
async function playlist(n) {
  const h = cache.get(n); if (h && Date.now() - h.t < 18e5) return h.b;
  const r = await fetch(`${BASE}/${n === 'english' ? 'languages' : 'countries'}/${PL[n]}.m3u`);
  if (!r.ok) throw new Error('upstream ' + r.status);
  const b = await r.text(); cache.set(n, { t: Date.now(), b }); return b;
}

// ---- database ----
let db;
const load = () => { try { db = JSON.parse(fs.readFileSync(DBF, 'utf8')); } catch (e) { db = {}; }
  db = Object.assign({ logo: null, ticker: '', speed: 15, items: [], ads: [], schedule: [], users: [] }, db); };
const save = () => fs.writeFileSync(DBF, JSON.stringify(db));
load();

const tokens = new Set(), fails = new Map();
const uid = () => crypto.randomUUID();
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type, x-token', 'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS' };
const send = (res, c, t, b) => { res.writeHead(c, { 'Content-Type': t, ...CORS }); res.end(b); };
const J = (res, c, o) => send(res, c, 'application/json', JSON.stringify(o));
const body = req => new Promise(r => { let s = ''; req.on('data', c => { s += c; if (s.length > 1e6) req.destroy(); });
  req.on('end', () => { try { r(JSON.parse(s || '{}')); } catch (e) { r({}); } }); });
const url = f => f ? '/media/' + f : '';
const pub = () => ({ logo: db.logo ? url(db.logo.file) : '', ticker: db.ticker, speed: db.speed,
  items: db.items.map(i => ({ ...i, url: url(i.file) })), ads: db.ads.map(i => ({ ...i, url: url(i.file) })), schedule: db.schedule });
const rm = f => { try { fs.unlinkSync(path.join(M, path.basename(f))); } catch (e) {} };

function media(req, res, f) {
  const p = path.join(M, path.basename(f));
  fs.stat(p, (e, s) => {
    if (e) return send(res, 404, 'text/plain', 'not found');
    const x = db.items.concat(db.ads).find(i => i.file === f) || (db.logo && db.logo.file === f ? db.logo : null);
    let st = 0, en = s.size - 1, code = 200;
    const h = { 'Content-Type': (x && x.mime) || 'application/octet-stream', 'Accept-Ranges': 'bytes', ...CORS };
    const m = (req.headers.range || '').match(/bytes=(\d*)-(\d*)/);
    if (m && (m[1] || m[2])) {
      if (m[1]) { st = +m[1]; if (m[2]) en = Math.min(+m[2], en); } else { st = Math.max(0, s.size - +m[2]); }
      if (st > en) { res.writeHead(416); return res.end(); }
      code = 206; h['Content-Range'] = `bytes ${st}-${en}/${s.size}`;
    }
    h['Content-Length'] = en - st + 1; res.writeHead(code, h);
    fs.createReadStream(p, { start: st, end: en }).pipe(res);
  });
}

// Registration (Gmail) / admin check — one input box
async function join(req, res, mode) { // mode: 'user' = Gmail only, 'admin' = admin only, none = both
  const ip = req.socket.remoteAddress, f = fails.get(ip) || { n: 0, t: Date.now() };
  if (Date.now() - f.t > 6e5) { f.n = 0; f.t = Date.now(); }
  if (f.n >= 10) return J(res, 429, { ok: false, msg: 'សូមរង់ចាំបន្តិច' });
  const bd = await body(req), v = String(bd.v || bd.email || bd.name || '').replace(/[\u200B-\u200D\uFEFF]/g, '').trim(); // ignore hidden zero-width chars (Khmer keyboards)
  if (mode !== 'user' && v === ADMIN) { const t = crypto.randomBytes(24).toString('hex'); tokens.add(t); return J(res, 200, { ok: true, msg: '(ត្រឹមត្រូវហើយ)', token: t }); }
  if (mode !== 'admin' && /^[\w.+-]{3,64}@gmail\.com$/i.test(v)) {
    const e = v.toLowerCase();
    if (!db.users.some(u => u.email === e)) { db.users.push({ email: e, time: new Date().toISOString(), device: String(bd.d || bd.device || '').slice(0, 40) }); save(); }
    return J(res, 200, { ok: true, msg: '✅ ចុះឈ្មោះបានសម្រេច' });
  }
  f.n++; fails.set(ip, f);
  J(res, 400, { ok: false, msg: '⚠️ សូមបញ្ចូល Gmail ឲ្យត្រឹមត្រូវ' });
}

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x'), p = decodeURIComponent(u.pathname), m = req.method; let r;
  if (m === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }
  try {
    if (p === '/' || p === '/index.html') return send(res, 200, 'text/html; charset=utf-8', fs.readFileSync(path.join(__dirname, 'index.html')));
    if ((r = p.match(/^\/playlist\/([a-z]+)\.m3u8?$/))) {
      if (!PL[r[1]]) return send(res, 404, 'text/plain', 'unknown');
      return send(res, 200, 'application/vnd.apple.mpegurl; charset=utf-8', await playlist(r[1]));
    }
    if ((r = p.match(/^\/media\/([\w.-]+)$/))) return media(req, res, r[1]);
    if (p === '/api/state') return J(res, 200, pub());
    if (p === '/api/join' && m === 'POST') return join(req, res);
    if (p === '/api/register' && m === 'POST') return join(req, res, 'user');   // {email, device}
    if (p === '/api/admin' && m === 'POST') return join(req, res, 'admin');      // {name}
    if (!p.startsWith('/api/')) return send(res, 404, 'text/plain', 'not found');

    // ---- admin only ----
    if (!tokens.has(req.headers['x-token'])) return J(res, 401, { error: 'unauthorized' });

    if (p === '/api/upload' && m === 'POST') {
      const kind = u.searchParams.get('kind'), name = (u.searchParams.get('name') || 'file').slice(0, 100);
      const mime = String(req.headers['content-type'] || ''), type = mime.startsWith('video') ? 'vid' : mime.startsWith('image') ? 'img' : null;
      if (!type || (kind !== 'logo' && kind !== 'ad' && kind !== 'item')) return J(res, 400, { error: 'bad file' });
      const ext = (path.extname(name).match(/^\.\w{1,5}$/) || [''])[0], file = uid() + ext, ws = fs.createWriteStream(path.join(M, file));
      req.pipe(ws);
      ws.on('finish', () => {
        const rec = { id: uid(), type, name, file, mime };
        if (kind === 'logo') { if (db.logo) rm(db.logo.file); db.logo = { file, mime }; }
        else if (kind === 'ad') db.ads.push(rec); else db.items.push(rec);
        save(); J(res, 200, { ok: true });
      });
      ws.on('error', () => J(res, 500, { error: 'write failed' }));
      return;
    }
    if (p === '/api/ticker' && m === 'POST') { const b = await body(req); db.ticker = String(b.text || '').slice(0, 1000); db.speed = Math.max(4, +b.speed || 15); save(); return J(res, 200, { ok: true }); }
    if (p === '/api/yt' && m === 'POST') {
      const b = await body(req); if (!/^[\w-]{11}$/.test(b.src || '')) return J(res, 400, { error: 'bad id' });
      db.items.push({ id: uid(), type: 'yt', name: 'YouTube: ' + b.src, src: b.src, dur: +b.dur || 60 }); save(); return J(res, 200, { ok: true });
    }
    if (p === '/api/schedule' && m === 'POST') {
      const b = await body(req);
      if (!(b.day >= 0 && b.day <= 6) || !/^\d{2}:\d{2}$/.test(b.time || '') || !db.items.some(i => i.id === b.itemId)) return J(res, 400, { error: 'bad data' });
      db.schedule.push({ id: uid(), day: +b.day, time: b.time, title: String(b.title || '').slice(0, 120), itemId: b.itemId });
      db.schedule.sort((a, c) => a.day - c.day || a.time.localeCompare(c.time)); save(); return J(res, 200, { ok: true });
    }
    if ((r = p.match(/^\/api\/(items|ads|schedule)\/([\w-]+)$/)) && m === 'DELETE') {
      const list = db[r[1]], x = list.find(i => i.id === r[2]); if (!x) return J(res, 404, { error: 'none' });
      if (x.file) rm(x.file); db[r[1]] = list.filter(i => i.id !== r[2]);
      if (r[1] === 'items') db.schedule = db.schedule.filter(s => s.itemId !== r[2]);
      save(); return J(res, 200, { ok: true });
    }
    if (p === '/api/users' && m === 'GET') return J(res, 200, db.users);
    if (p === '/api/backup' && m === 'POST') {
      const n = new Date().toISOString().replace(/[:.]/g, '-'); fs.cpSync(D, path.join(B, n), { recursive: true }); return J(res, 200, { name: n });
    }
    if (p === '/api/backups' && m === 'GET') return J(res, 200, fs.readdirSync(B).sort().reverse());
    if (p === '/api/restore' && m === 'POST') {
      const n = String((await body(req)).name || ''), src = path.join(B, n);
      if (!/^[\w-]+$/.test(n) || !fs.existsSync(src)) return J(res, 400, { error: 'bad name' });
      fs.rmSync(D, { recursive: true, force: true }); fs.cpSync(src, D, { recursive: true }); load(); return J(res, 200, { ok: true });
    }
    J(res, 404, { error: 'not found' });
  } catch (e) { J(res, 500, { error: 'server error' }); }
}).listen(PORT, () => console.log('TV server: http://localhost:' + PORT));

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
server.listen(H2PORT, () => console.log('HTTP/2 server: http://localhost:' + H2PORT));
