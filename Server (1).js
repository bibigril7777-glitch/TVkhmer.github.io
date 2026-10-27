// Server.js — Node.js 18+ (no npm packages needed)
// Run:  node Server.js     Open: http://localhost:3000
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const BASE = 'https://iptv-org.github.io/iptv';

// name -> source playlist on iptv-org
const PLAYLISTS = {
  cambodia:  `${BASE}/countries/kh.m3u`,
  myanmar:   `${BASE}/countries/mm.m3u`,
  indian:    `${BASE}/countries/in.m3u`,
  chinese:   `${BASE}/countries/cn.m3u`,
  taiwan:    `${BASE}/countries/tw.m3u`,
  indonesia: `${BASE}/countries/id.m3u`,
  russian:   `${BASE}/countries/ru.m3u`,
  philippines:`${BASE}/countries/ph.m3u`,
  malaysian: `${BASE}/countries/my.m3u`,
  japanese:  `${BASE}/countries/jp.m3u`,
  america:   `${BASE}/countries/us.m3u`,
  english:   `${BASE}/languages/eng.m3u`,
  spain:     `${BASE}/countries/es.m3u`,
  ukraine:   `${BASE}/countries/ua.m3u`,
  iran:      `${BASE}/countries/ir.m3u`,
  iraq:      `${BASE}/countries/iq.m3u`,
  qatar:     `${BASE}/countries/qa.m3u`,
  vietnam:   `${BASE}/countries/vn.m3u`,
  laos:      `${BASE}/countries/la.m3u`,
  singapore: `${BASE}/countries/sg.m3u`,
  southkorea:`${BASE}/countries/kr.m3u`,
  northkorea:`${BASE}/countries/kp.m3u`,
  syria:     `${BASE}/countries/sy.m3u`,
  southafrica:`${BASE}/countries/za.m3u`,
  israel:    `${BASE}/countries/il.m3u`,
  sweden:    `${BASE}/countries/se.m3u`,
};

const cache = new Map(); // name -> { time, body }
const TTL = 30 * 60 * 1000; // 30 minutes

async function getPlaylist(name) {
  const hit = cache.get(name);
  if (hit && Date.now() - hit.time < TTL) return hit.body;
  const r = await fetch(PLAYLISTS[name]);
  if (!r.ok) throw new Error('Upstream ' + r.status);
  const body = await r.text();
  cache.set(name, { time: Date.now(), body });
  return body;
}

function send(res, code, type, body) {
  res.writeHead(code, {
    'Content-Type': type,
    'Access-Control-Allow-Origin': '*',
  });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = decodeURIComponent(url.pathname);

  try {
    // List of available playlists
    if (p === '/api/playlists') {
      return send(res, 200, 'application/json', JSON.stringify(Object.keys(PLAYLISTS)));
    }

    // /playlist/cambodia.m3u8  (also .m3u)
    const m = p.match(/^\/playlist\/([a-z]+)\.m3u8?$/i);
    if (m) {
      const name = m[1].toLowerCase();
      if (!PLAYLISTS[name]) return send(res, 404, 'text/plain', 'Unknown playlist');
      const body = await getPlaylist(name);
      return send(res, 200, 'application/vnd.apple.mpegurl; charset=utf-8', body);
    }

    // Static file: index.html
    if (p === '/' || p === '/index.html') {
      const html = fs.readFileSync(path.join(__dirname, 'index.html'));
      return send(res, 200, 'text/html; charset=utf-8', html);
    }

    send(res, 404, 'text/plain', 'Not found');
  } catch (e) {
    send(res, 502, 'text/plain', 'Error: ' + e.message);
  }
});

server.listen(PORT, () => {
  console.log(`TV server running: http://localhost:${PORT}`);
  console.log('Playlists: ' + Object.keys(PLAYLISTS).map(k => `/playlist/${k}.m3u8`).join('  '));
});
