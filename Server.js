// Server.js — Node.js 18+ (no npm packages needed)
// Run:  node Server.js     Open: http://localhost:3000
const http = require('http');
const fs = require('fs');
const path = require('path');

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

function send(res, code, type, body) {
  res.writeHead(code, { 'Content-Type': type, 'Access-Control-Allow-Origin': '*' });
  res.end(body);
}

http.createServer(async (req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  try {
    if (p === '/api/playlists') return send(res, 200, 'application/json', JSON.stringify(Object.keys(PL)));
    const m = p.match(/^\/playlist\/([a-z]+)\.m3u8?$/i);
    if (m) {
      const name = m[1].toLowerCase();
      if (!PL[name]) return send(res, 404, 'text/plain', 'Unknown playlist');
      return send(res, 200, 'application/vnd.apple.mpegurl; charset=utf-8', await getPlaylist(name));
    }
    if (p === '/' || p === '/index.html')
      return send(res, 200, 'text/html; charset=utf-8', fs.readFileSync(path.join(__dirname, 'index.html')));
    send(res, 404, 'text/plain', 'Not found');
  } catch (e) {
    send(res, 502, 'text/plain', 'Error: ' + e.message);
  }
}).listen(PORT, () => {
  console.log(`TV server running: http://localhost:${PORT}`);
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
server.listen(H2PORT, () => console.log('HTTP/2 server: http://localhost:' + H2PORT));
