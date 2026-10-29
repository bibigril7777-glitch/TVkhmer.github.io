# Cambodia M3 TV

## Run locally
1. Install Node.js 18 or newer.
2. Copy `.env.example` to `.env`.
3. Set `ADMIN_USERNAME=phengchen888`, a strong `ADMIN_PASSWORD`, and a long random `SESSION_SECRET` in `.env`. Admin login does not need Gmail.
4. Optional: set `GOOGLE_CLIENT_ID` and the same value in `name.js` for Google Sign-In.
5. In Google Cloud Console, configure an OAuth 2.0 Web client and add your site origin (for local development: `http://localhost:3000`) to Authorized JavaScript origins.
6. Run:
   ```bash
   npm install
   npm start
   ```
7. Open `http://localhost:3000`. Sign in as Admin using username `phengchen888` and the password in `.env`. Regular viewers can register with their name and email/password or use Google Sign-In; Admin must approve them before they can view channel streams.

## Included
- Responsive Khmer TV station UI, Cambodia timezone clock
- Admin-only logo upload, custom animated caption below logo, ticker text, articles/photos/videos and weekly schedules
- Upload video files from a phone or use a direct playable video URL; video playback loops and scheduled streams can take over at their scheduled time
- Player controls for play/resume, mute/unmute and stop; schedule categories include animal documentaries, series, comedy, movies, cartoons, entertainment and story recaps
- Weekly schedule Monday–Sunday; video schedule hidden until a user signs in
- Email/password accounts and Google Identity Services sign-in
- Parsed channel entries from public country M3U playlists for Cambodia, Myanmar, India, China, Taiwan, Indonesia and Hong Kong from IPTV-org

## Important limitations / production checklist
- The server parses public `.m3u` country playlists into individual stream links (up to 120 per country). Some entries are not direct `.m3u8` streams, and browser playback may fail due to format, CORS, geo-blocking, or upstream outages. A production player can add hls.js for compatible HLS streams.
- `iptv-org` is a community playlist project. Only publish/stream channels you have permission to use. No IPTV.com scraping or unverified streams are included.
- The sample stores users and content in `data/db.json` and uploads in `uploads/`. Use a database, HTTPS, secure session store, backups, rate limiting, CSRF protections, file scanning, and storage limits before production deployment.
- Email/password registration does not verify email ownership. Google Sign-In verifies Google accounts when configured.
- Anyone can register, but viewing channel streams requires Admin approval. Keep `.env` private. Direct video URLs must point to a playable media file/stream (such as MP4 or a compatible HLS URL), not a normal webpage.
