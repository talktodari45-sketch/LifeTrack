/* ============================================================
   LifeTrack -- MongoDB sync server (Atlas-ready)
   Bridges the LifeTrack web app (even the hosted FC version,
   via CORS) to MongoDB Atlas or any MongoDB server.

   Endpoints:
     GET  /api/health   -> { ok, message }  (also pings MongoDB)
     GET  /api/data     -> { records, reading, writing, phrases, settings }
     POST /api/data     -> upserts all datasets into MongoDB

   Configuration (.env in this folder, or real environment vars):
     MONGO_URL   Atlas / MongoDB connection string
     DB          database name  (default: lifetrack)
     PORT        HTTP port      (default: 3000)
     SYNC_KEY    optional shared secret; when set, every /api/data
                 request must send the header:  x-sync-key: <value>

   Run:
     npm install
     npm start

   SECURITY:
     - The connection string (contains the password) lives ONLY in
       .env -- never put it in website code or commit it to git.
     - If SYNC_KEY is set, /api/data requires the x-sync-key header,
       so random strangers cannot read or overwrite the journal.
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const { MongoClient } = require('mongodb');

/* ---- tiny .env loader (zero dependencies) ---- */
(function loadDotEnv() {
  let raw;
  try {
    raw = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
  } catch (_) {
    return; /* no .env -> use real environment variables */
  }
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    const key = m[1];
    let val = m[2].trim();
    if (val.length >= 2) {
      const first = val[0];
      const last = val[val.length - 1];
      if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
        val = val.slice(1, -1);
      }
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
})();

const PORT = Number(process.env.PORT || 3000);
const MONGO_URL = process.env.MONGO_URL || 'mongodb://127.0.0.1:27017';
const DB_NAME = process.env.DB || 'lifetrack';
const SYNC_KEY = process.env.SYNC_KEY || '';

const COLLECTIONS = ['english_records', 'english_reading', 'english_writing', 'english_phrases', 'english_settings'];

/* hide the password when printing the connection string */
function maskedUrl(u) {
  return u.replace(/\/\/[^@/]+@/, '//***@');
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, x-sync-key');
  res.setHeader('Access-Control-Max-Age', '86400');
  /* Private Network Access: lets a public (HTTPS) hosted page reach this localhost server */
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
}

function json(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 20 * 1024 * 1024) { reject(new Error('Body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      try { resolve(raw ? JSON.parse(raw) : {}); } catch (_) { reject(new Error('Invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

function keyOk(req) {
  return !SYNC_KEY || req.headers['x-sync-key'] === SYNC_KEY;
}

let sharedClient = null;
function getClient() {
  if (!sharedClient) {
    sharedClient = new MongoClient(MONGO_URL, {
      serverSelectionTimeoutMS: 10000,
      connectTimeoutMS: 10000
    }).connect().catch((err) => { sharedClient = null; throw err; });
  }
  return sharedClient;
}

async function withMongo(fn) {
  const client = await getClient();
  return await fn(client.db(DB_NAME));
}

const server = http.createServer(async (req, res) => {
  res.on('finish', function () {
    console.log('  + ' + new Date().toISOString() + ' ' + req.method + ' ' + req.url + ' -> ' + res.statusCode + (req.headers.origin ? '  origin=' + req.headers.origin : ''));
  });
  cors(res);
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  try {
    /* health -- also verifies MongoDB is reachable */
    if (req.method === 'GET' && req.url === '/api/health') {
      await withMongo((db) => db.command({ ping: 1 }));
      return json(res, 200, { ok: true, message: 'Connected to MongoDB at ' + maskedUrl(MONGO_URL) + ' / ' + DB_NAME });
    }
    /* pull: read all datasets */
    if (req.method === 'GET' && req.url === '/api/data') {
      if (!keyOk(req)) return json(res, 401, { error: 'Missing or invalid x-sync-key header.' });
      const out = {};
      await withMongo(async (db) => {
        for (const name of COLLECTIONS) {
          const doc = await db.collection(name).findOne({ _id: 'main' });
          out[name.replace('english_', '')] = doc && doc.data !== undefined ? doc.data : null;
        }
      });
      return json(res, 200, { ok: true, data: out });
    }
    /* push: upsert all datasets */
    if (req.method === 'POST' && req.url === '/api/data') {
      if (!keyOk(req)) return json(res, 401, { error: 'Missing or invalid x-sync-key header.' });
      const body = await readBody(req);
      await withMongo(async (db) => {
        for (const name of COLLECTIONS) {
          const key = name.replace('english_', '');
          if (body && body[key] !== undefined && body[key] !== null) {
            await db.collection(name).replaceOne(
              { _id: 'main' },
              { _id: 'main', data: body[key], updatedAt: new Date().toISOString() },
              { upsert: true }
            );
          }
        }
      });
      return json(res, 200, { ok: true });
    }
    json(res, 404, { error: 'Not found' });
  } catch (e) {
    json(res, 500, { error: e.message || String(e) });
  }
});

server.listen(PORT, async () => {
  console.log('LifeTrack MongoDB sync server');
  console.log('  + listening on  http://localhost:' + PORT);
  console.log('  + MongoDB at    ' + maskedUrl(MONGO_URL) + ' / db ' + DB_NAME);
  console.log('  + sync key:     ' + (SYNC_KEY ? 'enabled (x-sync-key header required)' : 'disabled (open access)'));
  console.log('  + collections   ' + COLLECTIONS.join(', '));
  /* startup connectivity check -- clear error if MongoDB is unreachable */
  try {
    await withMongo((db) => db.command({ ping: 1 }));
    console.log('  + MongoDB:      connected (ping ok)');
  } catch (e) {
    console.log('  + MongoDB:      UNREACHABLE - ' + (e.message || String(e)));
    console.log('    Check MONGO_URL in .env and the Atlas Network Access allowlist.');
    console.log('    The server keeps running, but /api/health and sync calls will fail until MongoDB is up.');
  }
});

