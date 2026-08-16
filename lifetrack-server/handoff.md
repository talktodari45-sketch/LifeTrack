# LifeTrack ↔ Local MongoDB — Setup & Handoff

Connects the LifeTrack English Learning journal to the MongoDB running on this machine.
Status of this document: **verified against the actual setup on 2026-08-15.**

- App: static web app (also deployed to Function Compute for preview)
- Sync layer: `lifetrack-server/` — a small Node.js HTTP server
- Database: local MongoDB Community **8.3.8**, database `lifetrack`
- Verified: push → read back → test record → cleanup, all green (see [Verification](#verification))

---

## 1. How the pieces fit

```
Browser (LifeTrack app)          Node.js (lifetrack-server)          MongoDB (local)
┌─────────────────────┐   HTTP   ┌──────────────────────────┐  driver  ┌───────────────┐
│ Settings → MongoDB  │ ───────► │ GET/POST /api/data       │ ───────► │ 127.0.0.1:27017│
│ sync → Local server │ ◄─────── │ GET /api/health          │ ◄─────── │ db: lifetrack  │
└─────────────────────┘   JSON   └──────────────────────────┘          └───────────────┘
```

The browser cannot talk to MongoDB directly (it needs the wire protocol, which
browsers do not support). The Node server is the bridge. It also sends CORS
headers, so even the **hosted** preview of the app can reach the server on this
machine via `http://localhost:3000`.

---

## 2. Start MongoDB

MongoDB runs as a Windows service and starts automatically at boot.

```powershell
Get-Service MongoDB          # Status should be "Running"
Test-NetConnection 127.0.0.1 -Port 27017   # TcpTestSucceeded : True
```

If it is stopped:

```powershell
net start MongoDB
```

---

## 3. Start the sync server

```bash
cd lifetrack-server
npm install        # one-time; installs the official mongodb driver
npm start
```

Expected output:

```
LifeTrack local MongoDB sync server
  → listening on  http://localhost:3000
  → MongoDB at    mongodb://127.0.0.1:27017 / db lifetrack
  → collections   english_records, english_reading, english_writing, english_phrases, english_settings
  → MongoDB: ✅ connected (ping ok)
```

Configuration is via environment variables (no secrets hardcoded):

| Variable    | Default                     | Purpose                    |
|-------------|-----------------------------|----------------------------|
| `PORT`      | `3000`                      | Server port                |
| `MONGO_URL` | `mongodb://127.0.0.1:27017` | MongoDB address            |
| `DB`        | `lifetrack`                 | Database name              |

Quick health check from another terminal:

```powershell
Invoke-RestMethod http://localhost:3000/api/health
# → ok=True, message="Connected to local MongoDB at mongodb://127.0.0.1:27017 / lifetrack"
```

---

## 4. Connect the app

1. Open the LifeTrack app (local `index.html` or the hosted preview).
2. **Settings → MongoDB sync** → choose **Local MongoDB server**.
3. Server URL: `http://localhost:3000` (default).
4. **🔌 Test connection** → toast: *"Connected to local MongoDB server"*.
5. **⬆️ Push local → MongoDB** to upload your journal.
6. On another browser/device: same settings, then **⬇️ Pull MongoDB → local**.

Optional: tick **Auto-push after changes** — every save is written to MongoDB
about 1.5 s later.

---

## 5. Inspect in MongoDB Compass

1. Open Compass (installed at `C:\Users\ajith\AppData\Local\MongoDBCompass`).
2. New connection → paste `mongodb://127.0.0.1:27017` → **Connect**.
3. Left sidebar: database **lifetrack** → expand → 5 collections:
   `english_records`, `english_reading`, `english_writing`, `english_phrases`, `english_settings`.
4. Each collection holds one document with `_id: "main"` containing the full
   dataset in its `data` field, e.g. `english_records.data` = array of activity records.

Data layout:

| Collection         | Contents                                      | Docs (verified) |
|--------------------|-----------------------------------------------|-----------------|
| `english_records`  | activity log (topic, duration, notes, score)  | 1 (`data`: 108 records) |
| `english_reading`  | books → chapters → pages with statuses        | 1 (`data`: 10 pages)   |
| `english_writing`  | writing materials + pages                     | 1 (`data`: 3 pages)    |
| `english_phrases`  | phrases + review state                        | 1 (`data`: 25 phrases) |
| `english_settings` | daily goals                                   | 1 (`data`: 6 goals)    |

> Record count varies per push (the app seeds demo data on first visit);
> counts above reflect the last verified push.

---

## 6. Verify from the command line

```bash
cd lifetrack-server
npm run check
```

Expected output (all OK):

```
LifeTrack MongoDB check
  → mongodb://127.0.0.1:27017 / db lifetrack
  → connection:  OK (MongoDB 8.3.8)
  → ping:        OK
  → database:    lifetrack exists, collections: english_phrases, ...
  → app data:    all collections present, document counts: {"phrases":1,"reading":1,"records":1,"settings":1,"writing":1}
```

---

## 7. Error handling (verified)

If MongoDB is stopped or unreachable, nothing fails silently:

- **Server startup** prints `MongoDB: ❌ UNREACHABLE — connect ECONNREFUSED ...`
  and keeps running, so the app still loads.
- **`GET /api/health`** returns `HTTP 500` with `{"error":"connect ECONNREFUSED ..."}`.
- **App Test connection** shows the error in a toast instead of hanging.

Simulated and verified with `MONGO_URL=mongodb://127.0.0.1:27099` (nothing there).

---

## 8. Verification (2026-08-15)

Ran against the real local MongoDB 8.3.8, through the real sync server:

1. Pushed the app's real data (96 records, 10 reading pages, 3 writing pages,
   25 phrases, 6 goals) → `POST /api/data` → **200 ok**.
2. Read it back → **96/96 records**, 25/25 phrases matched.
3. Inspected in MongoDB via the driver → exactly the 5 collections above,
   each with `_id: "main"`.
4. Wrote a temporary record ("E2E roundtrip check") through the app sync path,
   read it back, confirmed it appeared in `english_records`, then removed it.
5. Final state: 96 records — no test data left behind.

**Real-browser UI verification (same day, later):** drove the actual app in
headless Chrome — Settings → **Local MongoDB server** → Test connection
(toast: *"Connected to local MongoDB at mongodb://127.0.0.1:27017 / lifetrack"*)
→ **Push local → MongoDB** → dashboard pill showed
*"🔄 Local MongoDB · synced 2026-08-15"*. Config persisted under the
standard key `lifetrack.english.syncConfig`. App smoke suite: 92/92; sync UI
test: 8/8.

---

## 9. Troubleshooting

| Symptom | Fix |
|---------|-----|
| `ECONNREFUSED 127.0.0.1:27017` | MongoDB service is stopped → `net start MongoDB` |
| `EADDRINUSE 3000` | Port busy → `$env:PORT="3100"` then `npm start`, use `http://localhost:3100` in the app |
| Compass shows empty `lifetrack` DB | Push from the app first (Settings → Push local → MongoDB) |
| App on the hosted site can't reach the server | Hosted page must run in a browser **on this machine** (it calls your localhost); or use Atlas mode instead |
| Key `lifetrack.english.syncConfig` has `mode: "atlas"` | Switch to **Local MongoDB server** in Settings |

Security note: the server has no authentication and is meant for local/trusted use.
Do not expose port 3000 to the internet.
