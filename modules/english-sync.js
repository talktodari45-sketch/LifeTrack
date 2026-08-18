/* ============================================================
   LifeTrack - English Learning - MongoDB sync (auto-save)
   Connects the journal to MongoDB through the local sync server
   (lifetrack-server), which bridges to MongoDB Atlas using the
   official MongoDB driver.

   Auto-save flow:
     user changes data -> frontend state updates (localStorage)
     -> debounced (600ms) whole-dataset push for frequent inputs
     -> immediate push for discrete actions (add/complete/delete)
     -> backend upserts into MongoDB (no duplicate records)
   On startup:
     - if a change was left unsynced (dirty), push it first
     - if this browser has no local data, pull MongoDB (source of truth)

   Save indicators: "Saving...", "Saved", "Unable to save - Retrying..."

   Setup:
     - Start the sync server:  lifetrack-server  (npm start)
     - The app defaults to  http://localhost:3000  (Settings -> MongoDB sync)

   Each dataset lives in its own collection (document _id "main"):
     english_records, english_reading, english_writing,
     english_phrases, english_settings
   ============================================================ */
(function () {
  'use strict';

  var LT = window.LifeTrack;
  var E = window.LTEnglish;
  var Store = LT.Store;
  var H = LT.helpers;
  var esc = H.esc, el = H.el, toast = H.toast;

  var CFG_KEY = 'english.syncConfig';
  var STATE_KEY = 'english.syncState';

  /* migrate configs saved under earlier fully-prefixed key names */
  (function migrateOldKeys() {
    var oldCfg = ['lifetrack.english.syncConfig'];
    var oldState = ['lifetrack.english.syncState'];
    if (Store.get(CFG_KEY, null) === null) {
      for (var i = 0; i < oldCfg.length; i++) {
        var v = Store.get(oldCfg[i], null);
        if (v !== null) { Store.set(CFG_KEY, v); Store.remove(oldCfg[i]); break; }
      }
    }
    if (Store.get(STATE_KEY, null) === null) {
      for (var j = 0; j < oldState.length; j++) {
        var v2 = Store.get(oldState[j], null);
        if (v2 !== null) { Store.set(STATE_KEY, v2); Store.remove(oldState[j]); break; }
      }
    }
  })();

  var COLLECTIONS = [
    { key: 'records', name: 'english_records', get: function () { return E.getRecords(); }, set: function (v) { E.saveRecords(v); } },
    { key: 'reading', name: 'english_reading', get: function () { return E.getReading(); }, set: function (v) { E.saveReading(v); } },
    { key: 'writing', name: 'english_writing', get: function () { return E.getWriting(); }, set: function (v) { E.saveWriting(v); } },
    { key: 'phrases', name: 'english_phrases', get: function () { return E.getPhrases(); }, set: function (v) { E.savePhrases(v); } },
    { key: 'settings', name: 'english_settings', get: function () { return E.getSettingsSnapshot(); }, set: function (v) { E.applySettingsSnapshot(v); } }
  ];

  /* ---- config / state ---- */
  /* PRODUCTION: set this to the deployed sync-backend HTTP URL (the Function
     Compute lifetrack-backend-fc trigger URL) once the backend is published.
     Leave '' for local development - the app then defaults to localhost:3000. */
  var PRODUCTION_SYNC_BASE = '';
  function isLocalHost() {
    var h = (typeof window !== 'undefined' && window.location && window.location.hostname) || '';
    return h === '' || h === 'localhost' || h === '127.0.0.1' || h === '::1';
  }
  function defaultConfig() {
    var base = 'http://localhost:3000';
    if (!isLocalHost() && PRODUCTION_SYNC_BASE) base = PRODUCTION_SYNC_BASE;
    return { mode: 'local', baseUrl: base, autoPush: true };
  }
  function getConfig() {
    var c = Store.get(CFG_KEY, null);
    if (!c) return defaultConfig();
    /* old Atlas Data API configs (mode 'atlas') migrate to sync-server mode */
    if (c.mode !== 'local' || !c.baseUrl) {
      c = { mode: 'local', baseUrl: c.baseUrl || 'http://localhost:3000', autoPush: !!c.autoPush };
    }
    if (c.autoPush === undefined) c.autoPush = true;
    /* apply production sync base to returning visitors with a legacy localhost default */
    if (!isLocalHost() && PRODUCTION_SYNC_BASE) {
      var legacyLocal = !c.baseUrl || c.baseUrl.indexOf('localhost') !== -1 || c.baseUrl.indexOf('127.0.0.1') !== -1;
      if (legacyLocal) c.baseUrl = PRODUCTION_SYNC_BASE;
    }
    return c;
  }
  function saveConfig(c) { Store.set(CFG_KEY, c); }
  function getState() { return Store.get(STATE_KEY, {}); }
  function saveState(s) { Store.set(STATE_KEY, s); }
  function mode() { return 'local'; }
  function isConfigured() {
    var c = getConfig();
    return !!(c && c.baseUrl);
  }
  function markDirty() { var st = getState(); st.dirty = true; saveState(st); }
  function markClean() { var st = getState(); st.dirty = false; saveState(st); }

  /* ---- save-state indicator (subtle, fixed bottom pill) ---- */
  var statusEl = null, statusTimer = null;
  function ensureStatusEl() {
    if (statusEl) return statusEl;
    statusEl = document.createElement('div');
    statusEl.id = 'sync-status';
    statusEl.setAttribute('role', 'status');
    statusEl.setAttribute('aria-live', 'polite');
    statusEl.style.cssText =
      'position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:99999;' +
      'background:rgba(17,24,39,.94);color:#e5e7eb;font:600 13px/1.2 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;' +
      'padding:8px 14px;border-radius:999px;box-shadow:0 4px 18px rgba(0,0,0,.22);' +
      'opacity:0;pointer-events:none;transition:opacity .25s ease;white-space:nowrap;';
    document.body.appendChild(statusEl);
    return statusEl;
  }
  function setSaveStatus(state) {
    var el = ensureStatusEl();
    var map = {
      saving: { text: 'Saving…', color: '#e5e7eb' },
      saved: { text: '✓ Saved', color: '#34d399' },
      error: { text: '⚠ Unable to save — Retrying…', color: '#fbbf24' }
    };
    if (!map[state]) { el.style.opacity = '0'; return; }
    var m = map[state];
    el.textContent = m.text;
    el.style.color = m.color;
    el.style.opacity = '1';
    if (statusTimer) clearTimeout(statusTimer);
    if (state === 'saved' || state === 'error') {
      statusTimer = setTimeout(function () { el.style.opacity = '0'; }, state === 'saved' ? 1800 : 6000);
    }
  }

  /* ---------------- HTTP plumbing ---------------- */
  function fetchWithTimeout(url, opts) {
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 15000) : null;
    return fetch(url, Object.assign({}, opts, ctrl ? { signal: ctrl.signal } : {}))
      .finally(function () { if (timer) clearTimeout(timer); });
  }
  function readJson(res) {
    return res.json().catch(function () { return {}; }).then(function (data) {
      if (!res.ok) throw new Error('HTTP ' + res.status + (data.error ? ': ' + data.error : ''));
      if (data && data.error) throw new Error(data.error);
      return data;
    });
  }

  /* ---------------- Sync server transport ---------------- */
  function localCall(path, method, body) {
    var cfg = getConfig();
    var base = String(cfg.baseUrl).replace(/\/+$/, '');
    return fetchWithTimeout(base + path, {
      method: method || 'GET',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    }).then(readJson);
  }

  function testConnection() {
    if (!isConfigured()) return Promise.resolve({ ok: false, message: 'Not configured - enter the server URL first.' });
    return localCall('/api/health').then(function (d) {
      return { ok: true, message: d.message || 'Connected to MongoDB sync server' };
    }).catch(function (err) {
      return { ok: false, message: err.message || 'Connection failed - is the server running on ' + getConfig().baseUrl + '?' };
    });
  }

  /* ---------------- Push / Pull ---------------- */
  function pushAll(silent) {
    var cfg = getConfig();
    if (!cfg || !isConfigured()) return Promise.resolve(false);
    setSaveStatus('saving');
    var payload = {};
    COLLECTIONS.forEach(function (col) { payload[col.key] = col.get(); });
    return localCall('/api/data', 'POST', payload).then(function () {
      var st = getState();
      st.lastPush = new Date().toISOString();
      st.lastError = null;
      st.dirty = false;
      saveState(st);
      setSaveStatus('saved');
      if (!silent) toast('Saved to MongoDB');
      return true;
    }).catch(function (err) {
      var st = getState();
      st.lastError = err.message || String(err);
      st.dirty = true; /* keep dirty so we retry and never lose the change */
      saveState(st);
      setSaveStatus('error');
      if (!silent) toast('Sync failed: ' + (err.message || err));
      return false;
    });
  }

  function pullAll(silent) {
    var cfg = getConfig();
    if (!cfg || !isConfigured()) return Promise.resolve(false);
    suppressPush = true;
    return localCall('/api/data', 'GET').then(function (d) {
      var data = d.data || d;
      var found = false;
      COLLECTIONS.forEach(function (col) {
        if (data[col.key] !== undefined && data[col.key] !== null) { col.set(data[col.key]); found = true; }
      });
      return found;
    }).then(function (found) {
      var st = getState();
      st.lastPull = new Date().toISOString();
      st.lastError = null;
      if (found) st.dirty = false;
      saveState(st);
      if (!silent) toast('Loaded data from MongoDB');
      return true;
    }).catch(function (err) {
      var st = getState();
      st.lastError = err.message || String(err);
      saveState(st);
      if (!silent) toast('Sync failed: ' + (err.message || err));
      return false;
    }).finally(function () { suppressPush = false; });
  }

  /* ---------------- Auto-push ---------------- */
  var pushTimer = null;
  var suppressPush = false;
  function maybeAutoPush(immediate) {
    if (suppressPush) return;
    var cfg = getConfig();
    if (!cfg || !cfg.autoPush || !isConfigured()) return;
    markDirty();
    if (immediate) {
      if (pushTimer) { clearTimeout(pushTimer); pushTimer = null; }
      pushAll(true);
      return;
    }
    if (pushTimer) clearTimeout(pushTimer);
    setSaveStatus('saving');
    pushTimer = setTimeout(function () { pushTimer = null; pushAll(true); }, 600);
  }
  /* fired from the core data layer on every save (immediate=true for actions) */
  window.LTEnglish._onDataChange = maybeAutoPush;

  /* ---------------- Startup hydration (MongoDB = source of truth) ---------------- */
  function settingsCustomized() {
    var dur = E.getDurations();
    if (dur && (dur.think !== 10 || dur.phrases !== 5)) return true;
    var g = E.getGoals();
    var dg = E.DEFAULT_GOALS || {};
    for (var k in dg) { if (g[k] !== dg[k]) return true; }
    return false;
  }
  function hasAnyLocalData() {
    return (E.getRecords().length > 0) ||
      (E.getPhrases().length > 0) ||
      ((E.getReading().materials || []).length > 0) ||
      ((E.getWriting().entries || []).length > 0) ||
      settingsCustomized();
  }
  function bootstrapSync() {
    if (!isConfigured()) return;
    if (getState().dirty) {
      /* a change was left unsynced when the page closed -> recover it first */
      pushAll(true).then(function () { if (!hasAnyLocalData()) pullAll(true); });
    } else if (!hasAnyLocalData()) {
      /* fresh browser -> hydrate from MongoDB instead of defaults */
      pullAll(true);
    }
  }
  setTimeout(bootstrapSync, 400);

  /* ---------------- UI: dashboard pill ---------------- */
  function renderPill() {
    var pill = el('a', 'sync-pill');
    if (!isConfigured()) {
      pill.href = '#/english/settings';
      pill.title = 'Set up MongoDB sync in Settings';
      pill.innerHTML = '\u2601 <span class="sync-label">MongoDB: not connected</span>';
      return pill;
    }
    var st = getState();
    var last = st.lastPush || st.lastPull;
    pill.href = '#/english/settings';
    pill.title = 'Auto-saves to MongoDB';
    pill.innerHTML = '\u2601 <span class="sync-label">MongoDB' +
      (last ? ' - synced ' + esc(last.slice(0, 10)) : ' - auto-save on') +
      (st.lastError ? ' - error' : '') + '</span>';
    pill.addEventListener('click', function (e) {
      if (isConfigured()) {
        e.preventDefault();
        pushAll(false);
      }
    });
    return pill;
  }

  /* ---------------- UI: settings section ---------------- */
  function renderSettings(wrap) {
    var card = el('div', 'card');
    card.appendChild(el('h2', null, 'MongoDB sync'));
    card.appendChild(el('div', 'card-sub',
      'Your changes auto-save to MongoDB. Start the sync server (lifetrack-server), then point the app at it.'));

    var form = el('div', 'form-grid');
    form.id = 'sync-form';
    card.appendChild(form);

    var help = el('div', 'about-line');
    help.textContent = 'Start the sync server first (lifetrack-server folder: npm start). The app defaults to http://localhost:3000.';
    card.appendChild(help);

    var status = el('div', 'about-line');
    card.appendChild(status);

    var row = el('div', 'tools-row');
    var bTest = el('button', 'btn ghost small', 'Test connection');
    var bPush = el('button', 'btn primary small', 'Push local -> MongoDB');
    var bPull = el('button', 'btn ghost small', 'Pull MongoDB -> local');
    var bClear = el('button', 'btn danger small', 'Disconnect');
    row.appendChild(bTest); row.appendChild(bPush); row.appendChild(bPull); row.appendChild(bClear);
    card.appendChild(row);
    wrap.appendChild(card);

    var c = getConfig() || {};
    form.innerHTML =
      '<label class="span2">Server URL<input id="sync-base" type="text" placeholder="http://localhost:3000"></label>' +
      '<label>Auto-save changes<input id="sync-auto" type="checkbox" style="width:auto;align-self:flex-start;margin-top:6px"></label>';
    form.querySelector('#sync-base').value = c.baseUrl || 'http://localhost:3000';
    form.querySelector('#sync-auto').checked = !!c.autoPush;

    function refreshStatus() {
      if (!isConfigured()) { status.textContent = 'Not connected - enter the server URL, then test.'; return; }
      var s = getState();
      var parts = ['Connected (auto-save on)'];
      if (s.lastPush) parts.push('pushed ' + s.lastPush.slice(0, 16).replace('T', ' '));
      if (s.lastPull) parts.push('pulled ' + s.lastPull.slice(0, 16).replace('T', ' '));
      if (s.lastError) parts.push('last error: ' + s.lastError);
      status.textContent = parts.join(' | ');
    }
    refreshStatus();

    function readForm() {
      var c = getConfig() || {};
      c.mode = 'local';
      c.baseUrl = form.querySelector('#sync-base').value.trim() || 'http://localhost:3000';
      c.autoPush = !!form.querySelector('#sync-auto').checked;
      return c;
    }

    bTest.addEventListener('click', function () {
      var c = readForm();
      saveConfig(c);
      bTest.textContent = 'Testing...';
      testConnection().then(function (r) {
        bTest.textContent = 'Test connection';
        refreshStatus();
        toast(r.ok ? r.message : 'Connection failed: ' + r.message);
      });
    });
    bPush.addEventListener('click', function () {
      var c = readForm();
      if (!isConfiguredValid(c)) { toast('Enter the server URL first'); return; }
      saveConfig(c);
      bPush.textContent = 'Pushing...';
      pushAll(false).then(function () { bPush.textContent = 'Push local -> MongoDB'; refreshStatus(); });
    });
    bPull.addEventListener('click', function () {
      var c = readForm();
      if (!isConfiguredValid(c)) { toast('Enter the server URL first'); return; }
      saveConfig(c);
      if (!window.confirm('Pull MongoDB data into this browser? It will REPLACE your current local data.')) return;
      bPull.textContent = 'Pulling...';
      pullAll(false).then(function () { bPull.textContent = 'Pull MongoDB -> local'; refreshStatus(); });
    });
    bClear.addEventListener('click', function () {
      if (!window.confirm('Disconnect MongoDB sync? Your local data stays untouched.')) return;
      Store.remove(CFG_KEY);
      Store.remove(STATE_KEY);
      toast('MongoDB sync disconnected');
      LT.render();
    });
  }
  function isConfiguredValid(c) { return !!(c && c.baseUrl); }

  /* ---------------- Public API ---------------- */
  window.LTEnglish.sync = {
    mode: mode,
    isConfigured: isConfigured,
    getConfig: getConfig,
    saveConfig: saveConfig,
    getState: getState,
    testConnection: testConnection,
    pushAll: pushAll,
    pullAll: pullAll,
    setSaveStatus: setSaveStatus,
    renderPill: renderPill,
    renderSettings: renderSettings
  };
  window.LTEnglish.sync.COLLECTIONS = COLLECTIONS;
})();
