/* ============================================================
   LifeTrack - English Learning - MongoDB sync
   Connects the journal to MongoDB through the local sync server
   (lifetrack-server), which bridges to MongoDB Atlas using the
   official MongoDB driver.

   The old "Atlas Data API" mode was removed: MongoDB shut that
   service down on 2025-09-30, so it can never work again.

   Setup:
     - Start the sync server:  lifetrack-server  (npm start)
     - In the app: Settings -> MongoDB sync
     - Server URL: http://localhost:3000
     - Test connection, then Push local -> MongoDB

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
  /* migrate configs saved under earlier/broken key names (older preview builds) */
  (function migrateOldKeys() {
    var oldCfg = ['lifetr\u2026nfig', 'lifetrack.english.syncConfig'];
    var oldState = ['lifetr\u2026tate', 'lifetrack.english.syncState'];
    for (var i = 0; i < oldCfg.length; i++) {
      if (Store.get(CFG_KEY, null) === null) {
        var v = Store.get(oldCfg[i], null);
        if (v !== null) { Store.set(CFG_KEY, v); Store.remove(oldCfg[i]); }
      }
    }
    for (var j = 0; j < oldState.length; j++) {
      if (Store.get(STATE_KEY, null) === null) {
        var v2 = Store.get(oldState[j], null);
        if (v2 !== null) { Store.set(STATE_KEY, v2); Store.remove(oldState[j]); }
      }
    }
  })();

  var COLLECTIONS = [
    { key: 'records', name: 'english_records', get: function () { return E.getRecords(); }, set: function (v) { E.saveRecords(v); } },
    { key: 'reading', name: 'english_reading', get: function () { return E.getReading(); }, set: function (v) { E.saveReading(v); } },
    { key: 'writing', name: 'english_writing', get: function () { return E.getWriting(); }, set: function (v) { E.saveWriting(v); } },
    { key: 'phrases', name: 'english_phrases', get: function () { return E.getPhrases(); }, set: function (v) { E.savePhrases(v); } },
    { key: 'settings', name: 'english_settings', get: function () { return E.getGoals(); }, set: function (v) { E.saveGoals(v); } }
  ];

  function getConfig() {
    var c = Store.get(CFG_KEY, null);
    /* old Atlas Data API configs (mode 'atlas' with endpoint/apiKey) are
       migrated to sync-server mode - the Data API was shut down in 2025 */
    if (c && (c.mode !== 'local' || !c.baseUrl)) {
      c = { mode: 'local', baseUrl: c.baseUrl || 'http://localhost:3000', autoPush: !!c.autoPush };
      saveConfig(c);
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
    var payload = {};
    COLLECTIONS.forEach(function (col) { payload[col.key] = col.get(); });
    return localCall('/api/data', 'POST', payload).then(function () {
      var st = getState();
      st.lastPush = new Date().toISOString();
      st.lastError = null;
      saveState(st);
      if (!silent) toast('Pushed local data to MongoDB');
      return true;
    }).catch(function (err) {
      var st = getState();
      st.lastError = err.message || String(err);
      saveState(st);
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
    }).then(function () {
      var st = getState();
      st.lastPull = new Date().toISOString();
      st.lastError = null;
      saveState(st);
      if (!silent) toast('Pulled MongoDB data into this browser');
      return true;
    }).catch(function (err) {
      var st = getState();
      st.lastError = err.message || String(err);
      saveState(st);
      if (!silent) toast('Sync failed: ' + (err.message || err));
      return false;
    }).finally(function () { suppressPush = false; });
  }

  /* ---------------- Auto-push (optional) ---------------- */
  var pushTimer = null;
  var suppressPush = false;
  function maybeAutoPush() {
    if (suppressPush) return;
    var cfg = getConfig();
    if (!cfg || !cfg.autoPush || !isConfigured()) return;
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(function () { pushAll(true); }, 1500);
  }
  /* fired from the core data layer on every save */
  window.LTEnglish._onDataChange = maybeAutoPush;

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
    pill.title = 'Sync now - push local data to MongoDB';
    pill.innerHTML = '\u2601 <span class="sync-label">MongoDB' +
      (last ? ' - synced ' + esc(last.slice(0, 10)) : '') +
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
      'Store your journal in MongoDB Atlas. Start the sync server (lifetrack-server), then point the app at it.'));

    var form = el('div', 'form-grid');
    form.id = 'sync-form';
    card.appendChild(form);

    var help = el('div', 'about-line');
    help.textContent = 'Start the sync server first (lifetrack-server folder: npm start), then enter its address below.';
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
      '<label>Auto-push after changes<input id="sync-auto" type="checkbox" style="width:auto;align-self:flex-start;margin-top:6px"></label>';
    form.querySelector('#sync-base').value = c.baseUrl || 'http://localhost:3000';
    form.querySelector('#sync-auto').checked = !!c.autoPush;

    function refreshStatus() {
      if (!isConfigured()) { status.textContent = 'Not connected - enter the server URL, then test.'; return; }
      var s = getState();
      var parts = ['Connected (sync server)'];
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
    renderPill: renderPill,
    renderSettings: renderSettings
  };
  window.LTEnglish.sync.COLLECTIONS = COLLECTIONS;
})();
