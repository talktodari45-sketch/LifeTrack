# LifeTrack -- MongoDB sync server (Atlas-ready)

A tiny Node.js server that connects the **LifeTrack English journal** web app to
**MongoDB Atlas** (or any MongoDB). The browser cannot talk to MongoDB directly,
so this server is the bridge: the app sends JSON over HTTP, the server stores it
in MongoDB, and vice versa.

## 1. Point it at MongoDB Atlas

1. Create a free cluster at https://www.mongodb.com/atlas (M0 free tier is fine).
2. Create a database user: Atlas -> Security -> Database Access -> Add New
   Database User (remember the password).
3. Allow network access: Atlas -> Security -> Network Access -> Add IP Address.
   Add the public IP of the machine that will run this server. For testing you
   can use `0.0.0.0/0` (anywhere) - remove it once you know the real IP.
4. Get the connection string: Atlas -> Database -> Connect -> Drivers.
   It looks like:
   `mongodb+srv://<user>:<password>@<cluster>.mongodb.net/?retryWrites=true&w=majority&appName=<name>`
5. Put it in the `.env` file in this folder (already created for you):

   ```
   MONGO_URL="mongodb+srv://<user>:<password>@<cluster>.mongodb.net/?appName=<name>"
   ```

   The `.env` file is git-ignored and never goes into the website code.

## 2. Start the sync server

```bash
cd lifetrack-server
npm install      # installs the official mongodb driver (only dependency)
npm start        # -> http://localhost:3000
```

Quick connectivity check (no server needed):

```bash
npm run check
```

Optional environment variables (`.env` or real env vars):

| Variable    | Default                       | Purpose                               |
|-------------|-------------------------------|---------------------------------------|
| `PORT`      | `3000`                        | Port the server listens on            |
| `MONGO_URL` | `mongodb://127.0.0.1:27017`   | Atlas / MongoDB connection string     |
| `DB`        | `lifetrack`                   | Database name                         |
| `SYNC_KEY`  | *(empty)*                     | Shared secret; when set, `/api/data` requires header `x-sync-key` |

Example with a custom port:

```bash
PORT=3100 node server.js    # PowerShell: $env:PORT=3100; node server.js
```

## 3. Connect the app

1. Open the LifeTrack app (local copy or the hosted preview).
2. Go to **Settings -> MongoDB sync**.
3. Choose **Local MongoDB server** (the backend mode).
4. Server URL: `http://localhost:3000` (or the public URL where the server is hosted).
5. Click **Test connection** -> should say "Connected to MongoDB".
6. Click **Push local -> MongoDB** to upload your journal.
7. On another device/browser: configure the same server URL and **Pull MongoDB -> local**.

Optional: tick **Auto-push after changes** so every new session, page, or phrase
is written to MongoDB ~1.5 s after you save it.

## 4. Syncing from the hosted site (cloud setup)

If the server runs on a public host (VPS, Render, Railway, Aliyun FC nodejs, ...):

- The app page can stay on Function Compute (nginx) - it just calls the server URL.
- **Enable `SYNC_KEY`** in `.env` so strangers cannot read/overwrite your journal:
  set it to a long random string and make the app send it as the `x-sync-key`
  header (the sync module needs a small update to send it).
- Keep the connection string ONLY in the server's environment, never in the page.

## Data layout

One collection per dataset, each holding a single `_id: "main"` document:

| Collection        | Contents                                  |
|-------------------|-------------------------------------------|
| `english_records` | activity log (topics, durations, notes)   |
| `english_reading` | books + chapters + pages with statuses    |
| `english_writing` | writing materials and pages               |
| `english_phrases` | phrases + review state                    |
| `english_settings`| daily goals                               |

## API

| Method | Path           | Body                     | Purpose                          |
|--------|----------------|--------------------------|----------------------------------|
| GET    | `/api/health`  | -                        | Ping + verify MongoDB reachable |
| GET    | `/api/data`    | -                        | Return all datasets             |
| POST   | `/api/data`    | `{records, reading, ...}`| Upsert all datasets             |

When `SYNC_KEY` is set, `GET/POST /api/data` return `401` unless the request
sends `x-sync-key: <value>`.

## Troubleshooting

- **"is not allowed to access the server" / IP error** -> Atlas Network Access:
  allow the IP of the machine running this server (or `0.0.0.0/0` for testing).
- **"Authentication failed"** -> wrong username/password in `MONGO_URL`; check
  Atlas -> Database Access.
- **`ENOTFOUND` / SRV lookup** -> check the cluster hostname in `MONGO_URL`
  (Atlas -> Connect -> Drivers).

## Security notes

- The connection string contains your Atlas password. It lives ONLY in `.env`
  (git-ignored) or the server's environment. Never put it in the website code.
- The server is meant for trusted use. If you expose it publicly, set `SYNC_KEY`.
