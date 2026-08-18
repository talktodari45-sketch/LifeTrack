/* ============================================================
   LifeTrack -- MongoDB sync server (Atlas-ready)
   Bridges the LifeTrack web app (even the hosted FC version,
   via CORS) to MongoDB Atlas or any MongoDB server.

   Endpoints:
     GET    /api/health           -> { ok, message }  (also pings MongoDB)
     GET    /api/data             -> { records, reading, writing, phrases, settings }
     POST   /api/data             -> upserts all datasets into MongoDB
     GET    /api/:collection      -> one dataset's data
     POST   /api/:collection      -> create/upsert one item (records, phrases)
     PUT    /api/:collection/:id  -> partial update one item ($set)
     DELETE /api/:collection/:id  -> remove one item ($pull)
     PUT    /api/settings         -> partial update settings (goals/durations)

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
const KEY_TO_COLL = {
  records: 'english_records',
  reading: 'english_reading',
  writing: 'english_writing',
  phrases: 'english_phrases',
  settings: 'english_settings'
};
/* collections whose data field is an array of {id, ...} records */
const ARRAY_COLLS = { records: true, phrases: true };

/* hide the password when printing the connection string */
function maskedUrl(u) {
  return u.replace(/\/\/[^@/]+@/, '//***@');
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, x-sync-key');
  res.setHeader('Access-Control-Max-Age', '86400');
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
      if (size > 64 * 1024 * 1024) { reject(new Error('Body too large')); req.destroy(); return; }
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

const now = () => new Date().toISOString();

/* ---- granular helpers (partial updates, no duplicate records) ---- */
async function upsertOne(db, name, item) {
  const col = db.collection(name);
  if (item && item.id) {
    const res = await col.updateOne(
      { _id: 'main', 'data.id': item.id },
      { $set: { 'data.$': item, updatedAt: now() } }
    );
    if (res.matchedCount > 0) return { ok: true, updated: true, id: item.id };
  }
  await col.updateOne(
    { _id: 'main' },
    { $set: { updatedAt: now() }, $push: { data: item } },
    { upsert: true }
  );
  return { ok: true, created: true, id: item.id };
}

async function patchOne(db, name, id, patch) {
  const col = db.collection(name);
  const setObj = { updatedAt: now() };
  for (const k of Object.keys(patch || {})) {
    if (k === 'id' || k === '_id') continue;
    setObj['data.$[e].' + k] = patch[k];
  }
  const res = await col.updateOne(
    { _id: 'main', 'data.id': id },
    { $set: setObj },
    { arrayFilters: [{ 'e.id': id }] }
  );
  return { ok: true, matched: res.matchedCount, modified: res.modifiedCount, id };
}

async function removeOne(db, name, id) {
  await db.collection(name).updateOne(
    { _id: 'main' },
    { $pull: { data: { id: id } }, $set: { updatedAt: now() } }
  );
  return { ok: true, id };
}

async function patchSettings(db, patch) {
  const setObj = { updatedAt: now() };
  for (const k of Object.keys(patch || {})) setObj['data.' + k] = patch[k];
  await db.collection('english_settings').updateOne({ _id: 'main' }, { $set: setObj }, { upsert: true });
  return { ok: true };
}

const server = http.createServer(async (req, res) => {
  res.on('finish', function () {
    console.log('  + ' + new Date().toISOString() + ' ' + req.method + ' ' + req.url + ' -> ' + res.statusCode + (req.headers.origin ? '  origin=' + req.headers.origin : ''));
  });
  cors(res);
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  const pathname = (req.url || '/').split('?')[0];
  const parts = pathname.split('/').filter(Boolean); /* ['api', ...] */

  try {
    if (parts[0] !== 'api') return json(res, 404, { error: 'Not found' });

    /* health */
    if (req.method === 'GET' && parts[1] === 'health') {
      await withMongo((db) => db.command({ ping: 1 }));
      return json(res, 200, { ok: true, message: 'Connected to MongoDB at ' + maskedUrl(MONGO_URL) + ' / ' + DB_NAME });
    }

    /* full dataset read */
    if (req.method === 'GET' && parts[1] === 'data') {
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

    /* full dataset upsert */
    if (req.method === 'POST' && parts[1] === 'data') {
      if (!keyOk(req)) return json(res, 401, { error: 'Missing or invalid x-sync-key header.' });
      const body = await readBody(req);
      await withMongo(async (db) => {
        for (const name of COLLECTIONS) {
          const key = name.replace('english_', '');
          if (body && body[key] !== undefined && body[key] !== null) {
            await db.collection(name).replaceOne(
              { _id: 'main' },
              { _id: 'main', data: body[key], updatedAt: now() },
              { upsert: true }
            );
          }
        }
      });
      return json(res, 200, { ok: true });
    }

    /* granular: partial update of settings (goals / durations) */
    if (parts[1] === 'settings' && req.method === 'PUT' && parts.length === 2) {
      if (!keyOk(req)) return json(res, 401, { error: 'Missing or invalid x-sync-key header.' });
      const patch = await readBody(req);
      const result = await withMongo((db) => patchSettings(db, patch));
      return json(res, 200, result);
    }

    /* granular: per-item CRUD for array collections (records, phrases) */
    const collKey = KEY_TO_COLL[parts[1]];
    if (collKey && ARRAY_COLLS[parts[1]]) {
      if (!keyOk(req)) return json(res, 401, { error: 'Missing or invalid x-sync-key header.' });

      /* GET one collection's items */
      if (req.method === 'GET' && parts.length === 2) {
        const result = await withMongo(async (db) => {
          const doc = await db.collection(collKey).findOne({ _id: 'main' });
          return doc && doc.data !== undefined ? doc.data : [];
        });
        return json(res, 200, { ok: true, data: result });
      }
      /* create / upsert one item */
      if (req.method === 'POST' && parts.length === 2) {
        const body = await readBody(req);
        if (!body || !body.id) return json(res, 400, { error: 'Item requires a stable "id" field.' });
        const result = await withMongo((db) => upsertOne(db, collKey, body));
        return json(res, 200, result);
      }
      /* partial update one item */
      if ((req.method === 'PUT' || req.method === 'PATCH') && parts.length === 3) {
        const patch = await readBody(req);
        const result = await withMongo((db) => patchOne(db, collKey, parts[2], patch));
        return json(res, 200, result);
      }
      /* delete one item */
      if (req.method === 'DELETE' && parts.length === 3) {
        const result = await withMongo((db) => removeOne(db, collKey, parts[2]));
        return json(res, 200, result);
      }
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
  try {
    await withMongo((db) => db.command({ ping: 1 }));
    console.log('  + MongoDB:      connected (ping ok)');
  } catch (e) {
    console.log('  + MongoDB:      UNREACHABLE - ' + (e.message || String(e)));
    console.log('    Check MONGO_URL in .env and the Atlas Network Access allowlist.');
    console.log('    The server keeps running, but /api/health and sync calls will fail until MongoDB is up.');
  }
});
