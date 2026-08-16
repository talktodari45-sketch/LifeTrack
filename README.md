# LifeTrack — English Learning Journal

A personal English-learning journal: activity log, reading & writing materials,
common phrases, calendar history, and progress tracking. Built as a static web
app (no framework, no build step) with an optional MongoDB sync layer.

## Structure

- `index.html` / `styles.css` / `app.js` — app shell and core engine
- `modules/` — English-learning module views (dashboard, speaking, think,
  listen, read, write, phrases, history, progress, settings) plus `english-sync.js`
- `lifetrack-server/` — tiny Node.js sync server bridging the app to MongoDB
  (Atlas or local) using the official `mongodb` driver
- `nginx.conf` — deployment config for Aliyun Function Compute (nginx environment)

## Run the app

Open `index.html` in any browser — no build step, no dependencies.

## MongoDB sync (MongoDB Atlas)

1. Create a free cluster at <https://www.mongodb.com/atlas>
2. Allow your IP in Atlas → Security → Network Access
3. In `lifetrack-server/`: copy `.env.example` to `.env` and set `MONGO_URL`
   to your Atlas connection string
4. `cd lifetrack-server && npm install && npm start` (serves on port 3000)
5. In the app: Settings → MongoDB sync → Server URL `http://localhost:3000` →
   Test connection → Push local → MongoDB

> ⚠️ Never commit `.env` — it contains your Atlas password (git-ignored).
> If you expose the server publicly, set `SYNC_KEY` in `.env` so `/api/data`
> requires the `x-sync-key` header.

Note: the old "Atlas Data API" sync mode was removed — MongoDB shut that
service down on 2025-09-30. Sync always goes through `lifetrack-server`.

## Backend API

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/health` | Ping + verify MongoDB reachable |
| GET | `/api/data` | Pull all datasets |
| POST | `/api/data` | Push (upsert) all datasets |
