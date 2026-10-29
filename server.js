// Cambodia M3 TV - Node.js/Express starter server
// Node 18+ recommended. Set SESSION_SECRET, ADMIN_EMAIL, GOOGLE_CLIENT_ID in .env.
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const { OAuth2Client } = require('google-auth-library');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const ROOT = __dirname, DATA = path.join(ROOT, 'data'), UPLOADS = path.join(ROOT, 'uploads');
for (const p of [DATA, UPLOADS]) fs.mkdirSync(p, {recursive:true});
const dbPath = path.join(DATA, 'db.json');
const seed = {
 users:[], posts:[], schedules:[], reports:[],
 brand:{stationName:'Cambodia M3 TV',topTicker:'សូមស្វាគមន៍មកកាន់ Cambodia M3 TV • ព័ត៌មាន និងកម្មវិធីថ្មីៗ',bottomTicker:'Cambodia M3 TV • សូមអរគុណដែលទស្សនា',logoUrl:'',tickerMotion:'bounce-fade'}
};
function readDB(){try{const db={...seed,...JSON.parse(fs.readFileSync(dbPath,'utf8'))};for(const k of ['users','posts','schedules','reports'])if(!Array.isArray(db[k]))db[k]=[];return db}catch{return structuredClone(seed)}}
function writeDB(db){fs.writeFileSync(dbPath,JSON.stringify(db,null,2))}
if(!fs.existsSync(dbPath))writeDB(seed);
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
app.disable('x-powered-by');
app.use(express.json({limit:'1mb'}));
app.use(express.urlencoded({extended:true}));
app.use(session({secret:process.env.SESSION_SECRET||'CHANGE_THIS_SESSION_SECRET_BEFORE_DEPLOYING',resave:false,saveUninitialized:false,cookie:{httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',maxAge:7*24*60*60*1000}}));
const storage=multer.diskStorage({destination:(req,file,cb)=>cb(null,UPLOADS),filename:(req,file,cb)=>cb(null,Date.now()+'-'+crypto.randomBytes(5).toString('hex')+path.extname(file.originalname).toLowerCase())});
const upload=multer({storage,limits:{fileSize:250*1024*1024},fileFilter:(req,file,cb)=>{const ok=/^(image\/|video\/)/.test(file.mimetype);cb(ok?null:new Error('អនុញ្ញាតតែរូបថត ឬវីដេអូ'),ok)}});
const logoUpload=multer({storage,limits:{fileSize:8*1024*1024},fileFilter:(req,file,cb)=>cb(file.mimetype.startsWith('image/')?null:new Error('Logo ត្រូវជារូបភាព'),file.mimetype.startsWith('image/'))});
function currentUser(req){if(!req.session.userId)return null;return readDB().users.find(u=>u.id===req.session.userId)||null}
function safeUser(u){return u?{id:u.id,email:u.email||'',name:u.name||u.username||'',username:u.username||'',role:u.role,provider:u.provider,approved:u.role==='admin'||u.approved===true}:null}
function auth(req,res,next){if(!currentUser(req))return res.status(401).json({error:'សូមចូលគណនីជាមុន'});next()}
function admin(req,res,next){const u=currentUser(req);if(!u||u.role!=='admin')return res.status(403).json({error:'មុខងារនេះសម្រាប់ Admin ប៉ុណ្ណោះ'});next()}
function normalizeEmail(email){return String(email||'').trim().toLowerCase()}
function ensureRole(email){return process.env.ADMIN_EMAIL&&normalizeEmail(email)===normalizeEmail(process.env.ADMIN_EMAIL)?'admin':'user'}
const ADMIN_USERNAME=String(process.env.ADMIN_USERNAME||'phengchen888').trim();
function approvedAccess(u){return !!u&&(u.role==='admin'||u.approved===true)}
function youtubeId(url){try{const u=new URL(url);if(u.hostname==='youtu.be')return u.pathname.slice(1).split('/')[0];if(['youtube.com','www.youtube.com','m.youtube.com','youtube-nocookie.com','www.youtube-nocookie.com'].includes(u.hostname)){if(u.pathname==='/watch')return u.searchParams.get('v');if(u.pathname.startsWith('/embed/'))return u.pathname.split('/')[2];if(u.pathname.startsWith('/live/'))return u.pathname.split('/')[2]}return null}catch{return null}}
app.use('/uploads',express.static(UPLOADS));
app.get('/api/me',(req,res)=>res.json({user:safeUser(currentUser(req))}));
app.post('/api/auth/register',async(req,res)=>{const name=String(req.body.name||'').trim().slice(0,100),email=normalizeEmail(req.body.email),password=String(req.body.password||'');if(name.length<2)return res.status(400).json({error:'សូមបញ្ចូលឈ្មោះយ៉ាងតិច ២ តួអក្សរ'});if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return res.status(400).json({error:'អ៊ីមែលមិនត្រឹមត្រូវ'});if(password.length<8)return res.status(400).json({error:'ពាក្យសម្ងាត់ត្រូវមានយ៉ាងតិច ៨ តួអក្សរ'});const db=readDB();if(db.users.some(u=>u.email===email))return res.status(409).json({error:'អ៊ីមែលនេះមានគណនីរួចហើយ'});const u={id:crypto.randomUUID(),name,email,passwordHash:await bcrypt.hash(password,12),role:ensureRole(email),approved:ensureRole(email)==='admin',provider:'email',createdAt:new Date().toISOString()};db.users.push(u);writeDB(db);req.session.userId=u.id;res.json({user:safeUser(u)})});
app.post('/api/auth/admin-login',async(req,res)=>{const username=String(req.body.username||'').trim(),password=String(req.body.password||''),db=readDB();if(username!==ADMIN_USERNAME||!process.env.ADMIN_PASSWORD||password!==process.env.ADMIN_PASSWORD)return res.status(401).json({error:'ឈ្មោះ Admin ឬពាក្យសម្ងាត់មិនត្រឹមត្រូវ។ ពិនិត្យ ADMIN_PASSWORD ក្នុង .env'});let u=db.users.find(x=>x.role==='admin'&&(x.username===ADMIN_USERNAME||x.email===normalizeEmail(process.env.ADMIN_EMAIL||'')));if(!u){u={id:crypto.randomUUID(),username:ADMIN_USERNAME,name:ADMIN_USERNAME,email:'',role:'admin',approved:true,provider:'admin',createdAt:new Date().toISOString()};db.users.push(u)}else{u.username=ADMIN_USERNAME;u.name=ADMIN_USERNAME;u.approved=true}writeDB(db);req.session.userId=u.id;res.json({user:safeUser(u)})});
app.post('/api/auth/login',async(req,res)=>{const email=normalizeEmail(req.body.email),password=String(req.body.password||''),db=readDB(),u=db.users.find(x=>x.email===email);if(!u||!u.passwordHash||!await bcrypt.compare(password,u.passwordHash))return res.status(401).json({error:'អ៊ីមែល ឬពាក្យសម្ងាត់មិនត្រឹមត្រូវ'});if(u.approved===undefined)u.approved=u.role==='admin';if(!u.name)u.name=u.email;writeDB(db);req.session.userId=u.id;res.json({user:safeUser(u)})});
app.post('/api/auth/google',async(req,res)=>{try{if(!process.env.GOOGLE_CLIENT_ID)return res.status(503).json({error:'Admin ត្រូវកំណត់ GOOGLE_CLIENT_ID ជាមុន'});const ticket=await googleClient.verifyIdToken({idToken:req.body.credential,audience:process.env.GOOGLE_CLIENT_ID});const payload=ticket.getPayload();if(!payload||!payload.email||!payload.email_verified)return res.status(401).json({error:'Google មិនបានផ្ទៀងផ្ទាត់អ៊ីមែល'});const email=normalizeEmail(payload.email),db=readDB();let u=db.users.find(x=>x.email===email);if(!u){u={id:crypto.randomUUID(),name:String(payload.name||email).slice(0,100),email,role:ensureRole(email),approved:ensureRole(email)==='admin',provider:'google',createdAt:new Date().toISOString()};db.users.push(u)}else if(ensureRole(email)==='admin'){u.role='admin';u.approved=true}if(u.approved===undefined)u.approved=u.role==='admin';writeDB(db);req.session.userId=u.id;res.json({user:safeUser(u)})}catch(e){res.status(401).json({error:'Google Sign-In មិនជោគជ័យ'})}});
app.get('/api/admin/users',admin,(req,res)=>{const db=readDB();res.json({users:db.users.map(safeUser)})});
app.post('/api/admin/users/:id/approve',admin,(req,res)=>{const db=readDB(),u=db.users.find(x=>x.id===req.params.id);if(!u)return res.status(404).json({error:'រកមិនឃើញគណនី'});u.approved=true;writeDB(db);res.json({user:safeUser(u)})});
app.post('/api/logout',(req,res)=>req.session.destroy(()=>res.json({ok:true})));
app.get('/api/brand',(req,res)=>res.json(readDB().brand));
app.post('/api/brand',admin,logoUpload.single('logo'),(req,res)=>{const db=readDB();db.brand.stationName=String(req.body.stationName||db.brand.stationName).slice(0,100);db.brand.topTicker=String(req.body.topTicker||'').slice(0,500);db.brand.bottomTicker=String(req.body.bottomTicker||'').slice(0,500);db.brand.logoCaption=String(req.body.logoCaption||'').slice(0,500);db.brand.tickerMotion=['scroll','bounce-fade','pulse'].includes(req.body.tickerMotion)?req.body.tickerMotion:'bounce-fade';if(req.file)db.brand.logoUrl='/uploads/'+req.file.filename;writeDB(db);res.json(db.brand)});
app.get('/api/posts',(req,res)=>res.json(readDB().posts.slice().sort((a,b)=>b.createdAt.localeCompare(a.createdAt))));
app.post('/api/posts',admin,upload.single('file'),(req,res)=>{const type=['article','photo','video','youtube'].includes(req.body.type)?req.body.type:'article';const category=String(req.body.category||'other').slice(0,60);const mediaUrl=String(req.body.mediaUrl||'').trim();const yt=type==='youtube'?youtubeId(req.body.youtubeUrl||mediaUrl):null;if(type==='youtube'&&!yt)return res.status(400).json({error:'សូមបញ្ចូលតំណ YouTube ត្រឹមត្រូវ'});if(type==='video'&&!req.file&&!/^https?:\/\//i.test(mediaUrl))return res.status(400).json({error:'សូមជ្រើសវីដេអូពីទូរស័ព្ទ ឬបញ្ចូលតំណវីដេអូ'});if(req.file&&type==='photo'&&!req.file.mimetype.startsWith('image/'))return res.status(400).json({error:'ប្រភេទរូបថតមិនត្រូវគ្នា'});if(req.file&&type==='video'&&!req.file.mimetype.startsWith('video/'))return res.status(400).json({error:'ប្រភេទវីដេអូមិនត្រូវគ្នា'});const post={id:crypto.randomUUID(),type,category,title:String(req.body.title||'').slice(0,180),body:String(req.body.body||'').slice(0,10000),fileUrl:req.file?'/uploads/'+req.file.filename:'',mediaUrl:type==='video'&&!req.file?mediaUrl:'',youtubeId:yt||'',createdAt:new Date().toISOString(),author:currentUser(req).email||currentUser(req).username};if(!post.title)return res.status(400).json({error:'សូមបញ្ចូលចំណងជើង'});const db=readDB();db.posts.push(post);writeDB(db);res.json(post)});

app.delete('/api/posts/:id',admin,(req,res)=>{const db=readDB(),post=db.posts.find(p=>p.id===req.params.id);if(!post)return res.status(404).json({error:'រកមិនឃើញមាតិកា'});db.posts=db.posts.filter(p=>p.id!==req.params.id);db.schedules=db.schedules.map(s=>s.postId===post.id?{...s,postId:'',streamUrl:s.streamUrl||''}:s);if(post.fileUrl){try{fs.unlinkSync(path.join(UPLOADS,path.basename(post.fileUrl)))}catch{}}writeDB(db);res.json({ok:true})});
app.get('/api/reports',auth,(req,res)=>{const db=readDB(),u=currentUser(req);res.json(db.reports.filter(r=>u.role==='admin'||r.userId===u.id).sort((a,b)=>a.createdAt.localeCompare(b.createdAt)))});
app.post('/api/reports',auth,(req,res)=>{const u=currentUser(req),message=String(req.body.message||'').trim().slice(0,4000),subject=String(req.body.subject||'រាយការណ៍').trim().slice(0,180);if(!message)return res.status(400).json({error:'សូមសរសេរសារជាមុន'});const db=readDB(),report={id:crypto.randomUUID(),userId:u.id,userName:u.name||u.username||u.email,userEmail:u.email||'',subject,message,createdAt:new Date().toISOString(),replies:[]};db.reports.push(report);writeDB(db);res.json(report)});
app.post('/api/reports/:id/reply',admin,(req,res)=>{const message=String(req.body.message||'').trim().slice(0,4000);if(!message)return res.status(400).json({error:'សូមសរសេរចម្លើយ'});const db=readDB(),report=db.reports.find(r=>r.id===req.params.id);if(!report)return res.status(404).json({error:'រកមិនឃើញសារ'});if(!Array.isArray(report.replies))report.replies=[];report.replies.push({id:crypto.randomUUID(),message,createdAt:new Date().toISOString(),by:'admin'});writeDB(db);res.json(report)});

app.get('/api/schedules',(req,res)=>{const db=readDB(),u=currentUser(req);res.json(db.schedules.filter(s=>s.kind!=='video'||approvedAccess(u)).sort((a,b)=>a.day-b.day||a.start.localeCompare(b.start)))});
app.post('/api/schedules',admin,(req,res)=>{const {title,start,end,streamUrl,mediaUrl,postId}=req.body,day=Number(req.body.day),kind=req.body.kind==='video'?'video':'program',category=String(req.body.category||'other').slice(0,60);if(!title||!/^([01]\d|2[0-3]):[0-5]\d$/.test(start||'')||!/^([01]\d|2[0-3]):[0-5]\d$/.test(end||'')||![0,1,2,3,4,5,6].includes(day))return res.status(400).json({error:'សូមបញ្ចូលព័ត៌មានកាលវិភាគឱ្យត្រឹមត្រូវ'});const db=readDB(),linked=db.posts.find(p=>p.id===postId);const s={id:crypto.randomUUID(),title:String(title).slice(0,180),day,start,end,kind,category,postId:linked?linked.id:'',streamUrl:/^https?:\/\//i.test(streamUrl||'')?String(streamUrl).slice(0,1000):(linked?(linked.fileUrl||linked.mediaUrl||''):''),mediaUrl:/^https?:\/\//i.test(mediaUrl||'')?String(mediaUrl).slice(0,1000):''};db.schedules.push(s);writeDB(db);res.json(s)});
app.delete('/api/schedules/:id',admin,(req,res)=>{const db=readDB();db.schedules=db.schedules.filter(s=>s.id!==req.params.id);writeDB(db);res.json({ok:true})});

// IPTV-org public playlists (community-maintained; availability/rights vary).
const countries=[
 ['Cambodia','https://iptv-org.github.io/iptv/countries/kh.m3u'],
 ['Myanmar','https://iptv-org.github.io/iptv/countries/mm.m3u'],
 ['India','https://iptv-org.github.io/iptv/countries/in.m3u'],
 ['China','https://iptv-org.github.io/iptv/countries/cn.m3u'],
 ['Taiwan','https://iptv-org.github.io/iptv/countries/tw.m3u'],
 ['Indonesia','https://iptv-org.github.io/iptv/countries/id.m3u'],
 ['Hong Kong','https://iptv-org.github.io/iptv/countries/hk.m3u']
];
app.get('/api/channels',async(req,res)=>{
  if(!approvedAccess(currentUser(req)))return res.json({source:'iptv-org/iptv public playlists',channels:[]});
  // Fetch and parse public M3U playlists server-side. Limit returned entries per country
  // so the page stays fast; upstream availability can change at any time.
  try {
    const all=[];
    for (const [country,playlistUrl] of countries) {
      try {
        const response=await fetch(playlistUrl,{signal:AbortSignal.timeout(9000)});
        if(!response.ok) continue;
        const text=await response.text();
        const lines=text.split(/\r?\n/);
        let title='';
        for(const line of lines) {
          if(line.startsWith('#EXTINF:')) {
            const comma=line.lastIndexOf(',');
            title=comma>=0?line.slice(comma+1).trim():'Channel';
            const tvgName=(line.match(/tvg-name="([^"]+)"/)||[])[1];
            if(tvgName) title=tvgName;
          } else if(line.trim() && !line.startsWith('#') && /^https?:\/\//i.test(line.trim())) {
            all.push({name:title||country+' channel',country,url:line.trim()});
            title='';
          }
          if(all.filter(c=>c.country===country).length>=120) break;
        }
      } catch(e) { console.warn('Playlist unavailable:',country,e.message); }
    }
    res.json({source:'iptv-org/iptv public playlists',channels:all});
  } catch(e) { res.status(502).json({error:'មិនអាចទាញយកបញ្ជីប៉ុស្តិ៍បានទេ',channels:[]}); }
});
app.get('/api/health',(req,res)=>res.json({ok:true,service:'Cambodia M3 TV'}));
app.get('/',(req,res)=>res.sendFile(path.join(ROOT,'index.html')));
app.use((err,req,res,next)=>{console.error(err.message);res.status(400).json({error:err.message||'មានបញ្ហា'})});
app.listen(PORT,()=>console.log(`Cambodia M3 TV running at http://localhost:${PORT}`));
