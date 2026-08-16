/* ============================================================
   LifeTrack -- MongoDB connectivity check
   Usage: npm run check   (or: node check.js)
   Verifies: MongoDB reachable + ping + lists the app database
   and its collections. Prints a short report for Compass handoff.
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');

/* ---- tiny .env loader (same as server.js) ---- */
(function loadDotEnv() {
  let raw;
  try {
    raw = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
  } catch (_) {
    return;
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

const MONGO_URL = process.env.MONGO_URL || 'mongodb://127.0.0.1:27017';
const DB_NAME = process.env.DB || 'lifetrack';
const COLLECTIONS = ['english_records', 'english_reading', 'english_writing', 'english_phrases', 'english_settings'];

function maskedUrl(u) {
  return u.replace(/\/\/[^@/]+@/, '//***@');
}

async function main() {
  const client = new MongoClient(MONGO_URL, { serverSelectionTimeoutMS: 10000, connectTimeoutMS: 10000 });
  console.log('LifeTrack MongoDB check');
  console.log('  + ' + maskedUrl(MONGO_URL) + ' / db ' + DB_NAME);
  try {
    await client.connect();
    const admin = client.db('admin');
    const buildInfo = await admin.command({ buildInfo: 1 });
    console.log('  + connection:  OK (MongoDB ' + buildInfo.version + ')');
    await admin.command({ ping: 1 });
    console.log('  + ping:        OK');

    const db = client.db(DB_NAME);
    const existing = (await db.listCollections().toArray()).map((c) => c.name).sort();
    console.log('  + database:    ' + DB_NAME + ' exists, collections: ' + (existing.length ? existing.join(', ') : '(none yet)'));

    const missing = COLLECTIONS.filter((n) => !existing.includes(n));
    if (missing.length) {
      console.log('  + app data:    collections missing (use the app: Settings -> MongoDB sync -> Push local -> MongoDB): ' + missing.join(', '));
    } else {
      const counts = {};
      for (const name of COLLECTIONS) counts[name.replace('english_', '')] = await db.collection(name).countDocuments();
      console.log('  + app data:    all collections present, document counts: ' + JSON.stringify(counts));
    }
    console.log('\nCheck finished - connect with Compass using the same MONGO_URL to see the ' + DB_NAME + ' database.');
  } catch (e) {
    console.log('  + FAILED: ' + (e.message || String(e)));
    console.log('\nTroubleshooting:');
    console.log('  1. Atlas: open Network Access and allow the IP of the machine running this server (or 0.0.0.0/0 for testing).');
    console.log('  2. Verify the username/password in MONGO_URL (Atlas: Database Access).');
    console.log('  3. Local MongoDB: start it (Windows: "MongoDB" service; macOS: brew services start mongodb-community; Linux: sudo systemctl start mongod).');
    process.exitCode = 1;
  } finally {
    await client.close();
  }
}
main();
