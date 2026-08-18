/* ============================================================
   LifeTrack — English Learning module (core)
   Journal-first: every practice session creates a real record.

   Views: dashboard · speaking · think · listen · history · progress · settings
   (read / write / phrases live in english-read.js, english-write.js,
   english-phrases.js and attach via LifeTrack.extendModule)

   AI-READY DESIGN (for later features):
   - All state lives in plain JSON under lifetrack.english.* keys
   - Records reference content by stable ids (ref: {type, id, ...})
   - Views are pure render functions over the data layer (window.LTEnglish)
   - AI features can be added as providers: LTEnglish.ai.register(provider)
     with hooks for correction / suggestion / scoring without touching
     the data model.
   ============================================================ */
(function () {
  'use strict';

  var LT = window.LifeTrack;
  var Store = LT.Store;
  var H = LT.helpers;
  var C = LT.charts;
  var esc = H.esc, uid = H.uid, todayISO = H.todayISO, addDays = H.addDays;
  var fmtDate = H.fmtDate, fmtDay = H.fmtDay, fmtMinutes = H.fmtMinutes;
  var parseISO = H.parseISO, startOfWeek = H.startOfWeek;
  var toast = H.toast, el = H.el;

  /* ---------------- Storage keys & config ---------------- */
  var REC_KEY = 'english.records';
  var READ_KEY = 'english.reading';
  var WRITE_KEY = 'english.writing';
  var PHRASE_KEY = 'english.phrases';
  var SET_KEY = 'english.settings';

  var ACTIVITIES = {
    speaking:  { label: 'Speaking',         icon: '🎤', color: '#10b981', goal: 15, unit: 'min' },
    think:     { label: 'Think in English', icon: '💭', color: '#8b5cf6', goal: 1,  unit: 'session' },
    listen:    { label: 'Listen & Imitate', icon: '🎧', color: '#6366f1', goal: 15, unit: 'min' },
    readAloud: { label: 'Read Aloud',       icon: '📖', color: '#f59e0b', goal: 2,  unit: 'pages' },
    writing:   { label: 'Writing',          icon: '✍️', color: '#ec4899', goal: 1,  unit: 'session' },
    phrases:   { label: 'Common Phrases',   icon: '💬', color: '#06b6d4', goal: 5,  unit: 'phrases' }
  };
  var ACTIVITY_IDS = Object.keys(ACTIVITIES);
  var SPEAK_MODES = {
    solo:   { label: 'Solo topic talk',     icon: '🎤' },
    person: { label: 'With another person', icon: '👥' },
    ai:     { label: 'With AI',             icon: '🤖' }
  };
  var DEFAULT_GOALS = { speaking: 15, think: 1, listen: 15, readAloud: 2, writing: 1, phrases: 5 };
  var DEFAULT_DURATIONS = { think: 10, phrases: 5 };

  function act(id) { return ACTIVITIES[id] || ACTIVITIES.speaking; }

  /* ---------------- Records ---------------- */
  function notifyChange() {
    if (window.LTEnglish && typeof window.LTEnglish._onDataChange === 'function') {
      try { window.LTEnglish._onDataChange(); } catch (e) { /* hook error */ }
    }
  }
  function getRecords() { return Store.get(REC_KEY, []); }
  function saveRecords(list) { Store.set(REC_KEY, list); notifyChange(); }
  function addRecord(r) {
    var list = getRecords();
    r.id = r.id || uid();
    r.date = r.date || todayISO();
    list.push(r);
    saveRecords(list);
    return r;
  }
  function updateRecord(id, patch) {
    var list = getRecords();
    var hit = null;
    list = list.map(function (x) { if (x.id === id) { hit = Object.assign({}, x, patch); return hit; } return x; });
    saveRecords(list);
    return hit;
  }
  function deleteRecord(id) {
    var list = getRecords().filter(function (r) { return r.id !== id; });
    saveRecords(list);
  }
  function sortByDateDesc(list) {
    return list.slice().sort(function (a, b) {
      return a.date < b.date ? 1 : a.date > b.date ? -1 : (b.createdAt || 0) - (a.createdAt || 0);
    });
  }
  /* Upsert a record that is tied to a content ref (e.g. one record per writing page) */
  function upsertRefRecord(refType, refId, data) {
    var list = getRecords();
    var existing = null;
    list.forEach(function (r) {
      if (r.ref && r.ref.type === refType && r.ref.id === refId) existing = r;
    });
    if (existing) {
      Object.keys(data).forEach(function (k) { existing[k] = data[k]; });
    } else {
      list.push(Object.assign({
        id: uid(), date: todayISO(), ref: { type: refType, id: refId }
      }, data));
    }
    saveRecords(list);
    return existing;
  }

  /* ---------------- Reading / Writing / Phrases stores ---------------- */
  function getReading() {
    var d = Store.get(READ_KEY, { materials: [] });
    if (!d || typeof d !== 'object') d = { materials: [] };
    var changed = false;
    function arr(x) { return x == null ? [] : (Array.isArray(x) ? x : [x]); }
    (d.materials || []).forEach(function (m) {
      (m.chapters || []).forEach(function (ch) {
        if (Array.isArray(ch.pages)) {
          var n = ch.pages.length;
          var first = ch.pages[0] || {};
          ch.pages = Math.max(1, n);
          if (first.photo != null) ch.photos = [first.photo];
          if (first.audio != null) ch.audios = [first.audio];
          changed = true;
        } else if (typeof ch.pages !== 'number') {
          ch.pages = 1;
          changed = true;
        }
        if (ch.photo != null && !Array.isArray(ch.photos)) ch.photos = [ch.photo];
        if (ch.audio != null && !Array.isArray(ch.audios)) ch.audios = [ch.audio];
        if (ch.photos == null) ch.photos = [];
        if (ch.audios == null) ch.audios = [];
        if ('photo' in ch) { delete ch.photo; changed = true; }
        if ('audio' in ch) { delete ch.audio; changed = true; }
      });
    });
    if (changed) Store.set(READ_KEY, d);
    return d;
  }
  function saveReading(d) { Store.set(READ_KEY, d); notifyChange(); }
  function getWriting() {
    var d = Store.get(WRITE_KEY, { entries: [] });
    if (!d || typeof d !== 'object') d = { entries: [] };
    var changed = false;
    if (d.materials && !d.entries) {
      var migrated = [];
      (d.materials || []).forEach(function (m) {
        (m.pages || []).forEach(function (p, pi) {
          migrated.push({
            id: p.id || uid(), title: m.title + (((m.pages || []).length > 1) ? ' \u2014 Page ' + (pi + 1) : ''),
            pages: 1, date: p.date || null, timeSpent: p.timeSpent || 0,
            photos: p.photo ? [p.photo] : [], createdAt: p.createdAt || Date.now()
          });
        });
      });
      d = { entries: migrated };
      changed = true;
    }
    if (!d.entries) d.entries = [];
    (d.entries || []).forEach(function (e) {
      if (e.photo !== undefined) {
        e.photos = Array.isArray(e.photos) ? e.photos : (e.photo ? [e.photo] : []);
        delete e.photo;
        changed = true;
      }
      if (!Array.isArray(e.photos)) { e.photos = []; changed = true; }
    });
    if (changed) Store.set(WRITE_KEY, d);
    return d;
  }
  function saveWriting(d) { Store.set(WRITE_KEY, d); notifyChange(); }
  function getPhrases() {
    var list = Store.get(PHRASE_KEY, []);
    var changed = false;
    (list || []).forEach(function (p) {
      if (p.photo != null && !Array.isArray(p.photos)) { p.photos = p.photo ? [p.photo] : []; delete p.photo; changed = true; }
      if (p.photos == null) { p.photos = []; changed = true; }
    });
    if (changed) Store.set(PHRASE_KEY, list);
    return list;
  }
  function savePhrases(list) { Store.set(PHRASE_KEY, list); notifyChange(); }
  function getGoals() {
    var s = Store.get(SET_KEY, {}) || {};
    var out = {};
    ACTIVITY_IDS.forEach(function (a) { out[a] = (typeof s[a] === 'number') ? s[a] : DEFAULT_GOALS[a]; });
    return out;
  }
  function saveGoals(g) {
    var s = Store.get(SET_KEY, {});
    if (!s || typeof s !== 'object' || Array.isArray(s)) s = {};
    ACTIVITY_IDS.forEach(function (a) { if (typeof g[a] === 'number') s[a] = g[a]; });
    Store.set(SET_KEY, s);
  }
  function getDurations() {
    var s = Store.get(SET_KEY, {}) || {};
    var d = (s && s.__durations && typeof s.__durations === 'object') ? s.__durations : {};
    var out = {};
    Object.keys(DEFAULT_DURATIONS).forEach(function (k) {
      out[k] = (typeof d[k] === 'number') ? d[k] : DEFAULT_DURATIONS[k];
    });
    return out;
  }
  function saveDurations(d) {
    var s = Store.get(SET_KEY, {});
    if (!s || typeof s !== 'object' || Array.isArray(s)) s = {};
    s.__durations = Object.assign({}, d);
    Store.set(SET_KEY, s);
  }
  function clearSettings() { Store.set(SET_KEY, {}); }
  function getCelebrations() {
    var s = Store.get(SET_KEY, {}) || {};
    return Array.isArray(s.__celebrations) ? s.__celebrations : [];
  }
  function recordCelebration(kind, activity) {
    var s = Store.get(SET_KEY, {});
    if (!s || typeof s !== 'object' || Array.isArray(s)) s = {};
    if (!Array.isArray(s.__celebrations)) s.__celebrations = [];
    s.__celebrations.push({ kind: kind, activity: activity, date: todayISO(), at: Date.now() });
    if (s.__celebrations.length > 200) s.__celebrations = s.__celebrations.slice(-200);
    Store.set(SET_KEY, s);
  }
  function alreadyCelebrated(kind, activity) {
    var d = todayISO();
    return getCelebrations().some(function (c) { return c.kind === kind && c.activity === activity && c.date === d; });
  }
  function todayProgress(activity) {
    var today = todayISO();
    var recs = getRecords().filter(function (r) { return r.activity === activity && r.date === today; });
    if (activity === 'speaking' || activity === 'listen') {
      return recs.reduce(function (a, r) { return a + (r.duration || 0); }, 0);
    }
    if (activity === 'think' || activity === 'writing') {
      return recs.length;
    }
    if (activity === 'readAloud') {
      return recs.reduce(function (a, r) { return a + (r.pages || 0); }, 0);
    }
    if (activity === 'phrases') {
      return phrasesByDay()[today] || 0;
    }
    return 0;
  }
  /* ---- Task-complete celebrations: small confetti + big module-complete blast ---- */
  function runConfetti(canvas, big) {
    var ctx = canvas.getContext('2d');
    var W = canvas.width = window.innerWidth;
    var H = canvas.height = window.innerHeight;
    var colors = ['#10b981', '#8b5cf6', '#6366f1', '#f59e0b', '#06b6d4', '#ec4899', '#fbbf24', '#fde68a', '#ffffff'];
    var parts = [];
    var perBurst = big ? 110 : 120;
    var bursts = big ? 3 : 1;
    for (var b = 0; b < bursts; b++) {
      var bx = W * (bursts === 1 ? 0.5 : (0.3 + 0.4 * b / (bursts - 1)));
      var by = H * 0.34;
      for (var i = 0; i < perBurst; i++) {
        var angle = Math.random() * Math.PI * 2;
        var speed = (big ? 7 : 5) + Math.random() * (big ? 13 : 8);
        parts.push({
          x: bx, y: by,
          vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 3,
          size: 4 + Math.random() * (big ? 8 : 5),
          color: colors[Math.floor(Math.random() * colors.length)],
          rot: Math.random() * Math.PI * 2, vr: (Math.random() - 0.5) * 0.3,
          life: 0, maxLife: 80 + Math.random() * 60,
          gravity: 0.12 + Math.random() * 0.09,
          shape: Math.random() < 0.5 ? 'rect' : 'circle'
        });
      }
    }
    var started = Date.now();
    function frame() {
      ctx.clearRect(0, 0, W, H);
      var alive = false;
      for (var i = 0; i < parts.length; i++) {
        var p = parts[i];
        if (p.life >= p.maxLife) continue;
        alive = true;
        p.life++;
        p.vy += p.gravity; p.vx *= 0.99;
        p.x += p.vx; p.y += p.vy; p.rot += p.vr;
        var alpha = Math.max(0, 1 - p.life / p.maxLife);
        ctx.globalAlpha = alpha;
        ctx.fillStyle = p.color;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        if (p.shape === 'rect') ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        else { ctx.beginPath(); ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2); ctx.fill(); }
        ctx.restore();
      }
      ctx.globalAlpha = 1;
      if (alive && Date.now() - started < 2600) requestAnimationFrame(frame);
      else ctx.clearRect(0, 0, W, H);
    }
    requestAnimationFrame(frame);
  }
  function celebrate(kind) {
    var big = kind === 'big';
    var overlay = el('div', 'celeb-overlay' + (big ? ' big' : ''));
    var emoji = big ? '🎉🎉🎉' : '🎉';
    overlay.innerHTML = '<div class="celeb-glow"></div><canvas class="celeb-canvas"></canvas>' +
      '<div class="celeb-card' + (big ? ' big' : '') + '">' +
      '<div class="celeb-emoji">' + emoji + '</div>' +
      '<div class="celeb-title">' + (big ? 'CONGRATULATIONS!' : 'Great Job!') + '</div>' +
      '<div class="celeb-sub">' + (big ? 'You completed the entire task!' : 'Task Complete!') + '</div>' +
      '</div>';
    document.body.appendChild(overlay);
    var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!reduced) runConfetti(overlay.querySelector('.celeb-canvas'), big);
    var dur = big ? 3000 : 1600;
    setTimeout(function () {
      overlay.classList.add('fade');
      setTimeout(function () { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }, 450);
    }, dur);
  }
  function onTaskComplete(activity) {
    var goals = getGoals();
    var goal = goals[activity] || 0;
    var prog = todayProgress(activity);
    if (goal > 0 && prog >= goal && !alreadyCelebrated('big', activity)) {
      recordCelebration('big', activity);
      celebrate('big');
    } else {
      recordCelebration('small', activity);
      celebrate('small');
    }
  }

  function wordCount(text) {
    var t = String(text || '').trim();
    return t ? t.split(/\s+/).length : 0;
  }
  function pageLabel(material, chapter, page, idx) {
    var parts = [material.title];
    if (chapter && chapter.title) parts.push(chapter.title);
    parts.push('Page ' + (idx != null ? idx + 1 : (page.number || '')));
    return parts.join(' — ');
  }
  function readingTotals(reading) {
    var r = reading || { materials: [] };
    var total = 0, chapters = 0;
    (r.materials || []).forEach(function (m) {
      (m.chapters || []).forEach(function (ch) {
        chapters++;
        total += (typeof ch.pages === 'number' ? ch.pages : (ch.pages || []).length || 1);
      });
    });
    return { total: total, done: total, inProgress: 0, practicedTimes: 0, minutes: 0, chapters: chapters };
  }
  function writingTotals(writing) {
    var w = writing || { entries: [] };
    var entries = w.entries || [];
    var total = 0, minutes = 0;
    entries.forEach(function (x) { total += (x.pages || 1); minutes += (x.timeSpent || 0); });
    return { total: total, done: total, inProgress: 0, words: 0, count: entries.length, minutes: minutes };
  }

  /* ---------------- Stats ---------------- */
  function computeStats(list) {
    var perAct = {};
    ACTIVITY_IDS.forEach(function (a) { perAct[a] = { minutes: 0, count: 0, scores: [] }; });
    var totalMinutes = 0, totalScore = 0, scoreCount = 0;
    list.forEach(function (r) {
      var pa = perAct[r.activity] || perAct.speaking;
      pa.count++;
      pa.minutes += r.duration || 0;
      totalMinutes += r.duration || 0;
      if (typeof r.score === 'number' && r.score > 0) { pa.scores.push(r.score); totalScore += r.score; scoreCount++; }
    });
    return {
      perAct: perAct, totalMinutes: totalMinutes,
      activeDays: Object.keys(list.reduce(function (m, r) { m[r.date] = 1; return m; }, {})).length,
      avgScore: scoreCount ? Math.round(totalScore / scoreCount) : null
    };
  }
  function computeStreak(list) {
    var dates = {};
    list.forEach(function (r) { dates[r.date] = true; });
    var streak = 0;
    var cursor = todayISO();
    if (!dates[cursor]) cursor = addDays(cursor, -1);
    while (dates[cursor]) { streak++; cursor = addDays(cursor, -1); }
    return streak;
  }
  function bucketize(list, mode) {
    var today = todayISO();
    var keys = [];
    if (mode === 'day') {
      for (var i = 13; i >= 0; i--) keys.push(addDays(today, -i));
    } else if (mode === 'week') {
      var thisMon = startOfWeek(today);
      for (var j = 7; j >= 0; j--) keys.push(addDays(thisMon, -j * 7));
    } else {
      var now = new Date();
      for (var m = 5; m >= 0; m--) {
        var d = new Date(now.getFullYear(), now.getMonth() - m, 1);
        keys.push(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'));
      }
    }
    function keyOf(r) {
      return mode === 'day' ? r.date : mode === 'week' ? startOfWeek(r.date) : r.date.slice(0, 7);
    }
    var buckets = keys.map(function (k) { return { key: k, minutes: 0, count: 0, scores: [] }; });
    var idx = {};
    keys.forEach(function (k, i) { idx[k] = i; });
    list.forEach(function (r) {
      var i = idx[keyOf(r)];
      if (i == null) return;
      var b = buckets[i];
      b.minutes += r.duration || 0; b.count++;
      if (typeof r.score === 'number' && r.score > 0) b.scores.push(r.score);
    });
    var labels = buckets.map(function (b) {
      if (mode === 'day') return parseISO(b.key).toLocaleDateString('en-US', { weekday: 'short' });
      if (mode === 'week') return fmtDay(b.key);
      return parseISO(b.key + '-01').toLocaleDateString('en-US', { month: 'short' });
    });
    return { buckets: buckets, labels: labels };
  }
  function avg(arr) { return arr.length ? Math.round(arr.reduce(function (a, b) { return a + b; }, 0) / arr.length) : null; }
  /* day map: date -> { minutes, records, activities:Set-ish } */
  function dayMap(list) {
    var m = {};
    list.forEach(function (r) {
      var d = m[r.date] || (m[r.date] = { minutes: 0, count: 0, activities: {} });
      d.minutes += r.duration || 0;
      d.count++;
      d.activities[r.activity] = (d.activities[r.activity] || 0) + 1;
    });
    return m;
  }
  /* phrases learned per day */
  function phrasesByDay() {
    var m = {};
    getPhrases().forEach(function (p) {
      var d = p.date || p.learned;
      var c = (typeof p.count === 'number' && p.count > 0) ? p.count : 1;
      if (d) m[d] = (m[d] || 0) + c;
    });
    return m;
  }
  function phrasesTotal() {
    return getPhrases().reduce(function (a, p) {
      return a + ((typeof p.count === 'number' && p.count > 0) ? p.count : 1);
    }, 0);
  }
  /* phrases learned bucketed by day/week/month (count-based, for charts) */
  function phraseBuckets(mode) {
    var today = todayISO();
    var keys = [];
    if (mode === 'day') {
      for (var i = 13; i >= 0; i--) keys.push(addDays(today, -i));
    } else if (mode === 'week') {
      var thisMon = startOfWeek(today);
      for (var j = 7; j >= 0; j--) keys.push(addDays(thisMon, -j * 7));
    } else {
      var now = new Date();
      for (var m = 5; m >= 0; m--) {
        var d = new Date(now.getFullYear(), now.getMonth() - m, 1);
        keys.push(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'));
      }
    }
    var counts = {};
    getPhrases().forEach(function (p) {
      var dd = p.date || p.learned;
      if (!dd) return;
      var k = mode === 'day' ? dd : mode === 'week' ? startOfWeek(dd) : dd.slice(0, 7);
      var c = (typeof p.count === 'number' && p.count > 0) ? p.count : 1;
      counts[k] = (counts[k] || 0) + c;
    });
    var labels = keys.map(function (b) {
      if (mode === 'day') return parseISO(b).toLocaleDateString('en-US', { weekday: 'short' });
      if (mode === 'week') return fmtDay(b);
      return parseISO(b + '-01').toLocaleDateString('en-US', { month: 'short' });
    });
    return { labels: labels, buckets: keys.map(function (k) { return { key: k, count: counts[k] || 0 }; }) };
  }
  /* generic time-series bucketing of an arbitrary numeric value (pages, counts, minutes) */
  function seriesBuckets(rows, mode, pick) {
    var today = todayISO();
    var keys = [];
    if (mode === 'day') {
      for (var i = 13; i >= 0; i--) keys.push(addDays(today, -i));
    } else if (mode === 'week') {
      var thisMon = startOfWeek(today);
      for (var j = 7; j >= 0; j--) keys.push(addDays(thisMon, -j * 7));
    } else {
      var now = new Date();
      for (var m = 5; m >= 0; m--) {
        var d = new Date(now.getFullYear(), now.getMonth() - m, 1);
        keys.push(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'));
      }
    }
    function keyOf(date) {
      return mode === 'day' ? date : mode === 'week' ? startOfWeek(date) : date.slice(0, 7);
    }
    var values = keys.map(function () { return 0; });
    var idx = {};
    keys.forEach(function (k, i) { idx[k] = i; });
    (rows || []).forEach(function (r) {
      var d = r.date || r.learned;
      if (!d) return;
      var i = idx[keyOf(d)];
      if (i == null) return;
      values[i] += pick(r) || 0;
    });
    var labels = keys.map(function (b) {
      if (mode === 'day') return parseISO(b).toLocaleDateString('en-US', { weekday: 'short' });
      if (mode === 'week') return fmtDay(b);
      return parseISO(b + '-01').toLocaleDateString('en-US', { month: 'short' });
    });
    return { labels: labels, values: values };
  }

  /* ---------------- Shared UI ---------------- */
  function card(title, sub) {
    var c = el('div', 'card');
    c.appendChild(el('h2', null, esc(title)));
    if (sub) c.appendChild(el('div', 'card-sub', esc(sub)));
    return c;
  }
  function statGrid(cards) {
    var grid = el('div', 'stat-grid');
    cards.forEach(function (c) {
      var cardEl = el('div', 'stat-card');
      cardEl.innerHTML = '<div class="stat-icon" style="background:' + c.color + '1a;color:' + c.color + '">' + c.icon + '</div>' +
        '<div class="stat-body"><div class="stat-value">' + esc(c.value) + '</div>' +
        '<div class="stat-label">' + esc(c.label) + '</div><div class="stat-sub">' + esc(c.sub) + '</div></div>';
      grid.appendChild(cardEl);
    });
    return grid;
  }
  function emptyState(container, title, sub, actions) {
    var e = el('div', 'empty-state');
    e.innerHTML = '<div class="big">🎯</div><h3>' + esc(title) + '</h3><p>' + esc(sub) + '</p>';
    if (actions && actions.length) {
      var row = el('div', 'form-actions', null);
      row.style.justifyContent = 'center';
      actions.forEach(function (a) { row.appendChild(a); });
      e.appendChild(row);
    }
    container.appendChild(e);
  }
  function statusChip(status) {
    var map = { 'not-started': ['Not started', 'st-not-started'], 'in-progress': ['In progress', 'st-in-progress'], completed: ['Completed', 'st-completed'], done: ['Done', 'st-completed'], partial: ['Partial', 'st-in-progress'] };
    var m = map[status] || ['—', 'st-not-started'];
    return el('span', 'st-chip ' + m[1], m[0]);
  }
  function scoreChip(score) {
    if (typeof score !== 'number' || score <= 0) return null;
    var cls = score >= 80 ? 'score-good' : score >= 60 ? 'score-mid' : 'score-low';
    return el('span', 'score-chip ' + cls, String(score));
  }
  function legendHTML(entries) {
    var total = entries.reduce(function (a, e) { return a + e.value; }, 0);
    return entries.filter(function (e) { return e.value > 0; })
      .sort(function (a, b) { return b.value - a.value; })
      .map(function (e) {
        var pct = total ? Math.round(e.value / total * 100) : 0;
        return '<div class="legend-row"><span class="legend-dot" style="background:' + e.color + '"></span>' +
          '<span class="legend-name">' + esc(e.label) + '</span>' +
          '<span class="legend-val">' + esc(fmtMinutes(e.value)) + ' · ' + pct + '%</span></div>';
      }).join('');
  }
  function goalBar(value, goal, color) {
    var pct = goal > 0 ? Math.min(100, Math.round(value / goal * 100)) : 0;
    var row = el('div', 'goal-row');
    row.innerHTML = '<div class="goal-body"><div class="goal-head"><span class="goal-name"></span><span class="goal-meta">' +
      (value >= goal && goal > 0 ? '<span class="goal-done">✓ goal met</span>' : '<span class="goal-nums"><b>' + value + '</b> / ' + goal + '</span>') +
      '</span></div><div class="goal-track"><div class="goal-fill" style="width:' + pct + '%;background:' + color + '"></div></div></div>';
    return row;
  }
  function goalRow(icon, color, name, value, goal, unit) {
    var row = goalBar(value, goal, color);
    var iconEl = el('div', 'goal-icon');
    iconEl.style.background = color + '1a';
    iconEl.textContent = icon;
    row.querySelector('.goal-name').textContent = name + (unit ? ' (' + unit + ')' : '');
    row.insertBefore(iconEl, row.firstChild);
    return row;
  }
  function recordRow(r, opts) {
    var a = act(r.activity);
    var row = el('div', 'recent-row');
    var modeTxt = (r.activity === 'speaking' && r.mode && SPEAK_MODES[r.mode]) ? ' · ' + SPEAK_MODES[r.mode].label : '';
    var sub = [r.topic, r.notes].filter(Boolean).map(function (s) { return esc(s.length > 60 ? s.slice(0, 60) + '…' : s); }).join(' — ');
    var sideParts = [];
    var mediaCount = Array.isArray(r.media) ? r.media.length : (r.media ? 1 : 0);
    if (r.duration) sideParts.push(esc(fmtMinutes(r.duration)));
    if (r.score > 0) sideParts.push(esc(String(r.score)) + '/100');
    row.innerHTML =
      '<div class="recent-icon" style="background:' + a.color + '18">' + a.icon + '</div>' +
      '<div class="recent-main"><div class="recent-title">' + esc(a.label + modeTxt) +
      (r.status === 'partial' ? ' <span class="st-chip st-in-progress">partial</span>' : '') +
      '</div><div class="recent-sub">' + esc(fmtDate(r.date)) + (sub ? ' · ' + sub : '') + (mediaCount ? ' · 📎 ' + (r.mediaType === 'audio' ? 'audio' : 'photo') + (mediaCount > 1 ? ' ×' + mediaCount : '') : '') + '</div></div>' +
      '<div class="recent-side"><div class="v">' + sideParts.join(' · ') + '</div>' +
      '<div class="s">' + (r.status === 'done' || !r.status ? '✅' : '') + '</div></div>';
    if (opts) {
      var actions = el('div', 'row-actions');
      var bEdit = el('button', 'btn-edit', '✏️');
      bEdit.title = 'Edit';
      bEdit.addEventListener('click', function () { opts.edit(r); });
      var bDel = el('button', 'btn-del', '🗑️');
      bDel.title = 'Delete';
      bDel.addEventListener('click', function () { opts.del(r); });
      actions.appendChild(bEdit); actions.appendChild(bDel);
      row.appendChild(actions);
    }
    return row;
  }
  function buildHeatmap(container, list) {
    var days = dayMap(list);
    var today = todayISO();
    var start = startOfWeek(addDays(today, -(14 * 7)));
    var cells = [];
    for (var i = 0; i < 15 * 7; i++) {
      var d = addDays(start, i);
      cells.push({ date: d, minutes: days[d] ? days[d].minutes : 0 });
    }
    var max = Math.max.apply(null, cells.map(function (c) { return c.minutes; })) || 1;
    var grid = el('div', 'hm-grid');
    cells.forEach(function (c) {
      var cell = el('div', 'hm-cell');
      var lvl = c.minutes === 0 ? 0 : c.minutes >= max * 0.66 ? 3 : c.minutes >= max * 0.33 ? 2 : 1;
      cell.classList.add('lvl' + lvl);
      cell.title = fmtDate(c.date) + (c.minutes ? ' · ' + fmtMinutes(c.minutes) + ' practiced' : ' · rest day');
      grid.appendChild(cell);
    });
    container.appendChild(grid);
  }

  /* ============================================================
     VIEW: Dashboard
     ============================================================ */
  function dashboard(view) {
    var list = getRecords();
    var stats = computeStats(list);
    var streak = computeStreak(list);
    var goals = getGoals();
    var today = todayISO();
    var todayRecs = list.filter(function (r) { return r.date === today; });
    var pbd = phrasesByDay();
    var reading = getReading(), writing = getWriting();
    var rTot = readingTotals(reading), wTot = writingTotals(writing);
    var dur = getDurations();

    var wrap = el('div', 'view-body');
    var hour = new Date().getHours();
    var greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
    var head = el('div', 'page-head');
    head.innerHTML = '<h1>' + greet + ' 👋</h1><p>' + esc(fmtDate(today)) + ' · ' +
      (todayRecs.length ? 'You practiced ' + todayRecs.length + ' activit' + (todayRecs.length === 1 ? 'y' : 'ies') + ' today — keep it up!' : 'Nothing logged yet today — 10 minutes counts.') + '</p>';
    if (window.LTEnglish.sync && window.LTEnglish.sync.renderPill) head.appendChild(window.LTEnglish.sync.renderPill());
    wrap.appendChild(head);

    if (!list.length && !getPhrases().length) {
      emptyState(wrap, 'Welcome to your English journal', 'Log speaking, listening, reading, writing and phrases — every session becomes a real learning record.');
      view.appendChild(wrap);
      return;
    }

    /* stats */
    var cards = [
      { icon: '🔥', label: 'Daily streak', value: streak + ' day' + (streak === 1 ? '' : 's'), sub: streak > 0 ? 'consecutive days' : 'start today', color: '#f59e0b' },
      { icon: '⏱️', label: 'Total practice', value: fmtMinutes(stats.totalMinutes), sub: stats.activeDays + ' active days', color: '#6366f1' },
      { icon: '💬', label: 'Phrases learned', value: String(phrasesTotal()), sub: 'all time', color: '#06b6d4' },
      { icon: '📖', label: 'Pages read', value: rTot.done, sub: rTot.chapters + ' chapters', color: '#f59e0b' },
      { icon: '✍️', label: 'Pages written', value: wTot.done, sub: wTot.total + ' total pages', color: '#ec4899' }
    ];
    var grid = el('div', 'stat-grid');
    cards.forEach(function (c) {
      var cardEl = el('div', 'stat-card');
      cardEl.innerHTML = '<div class="stat-icon" style="background:' + c.color + '1a;color:' + c.color + '">' + c.icon + '</div>' +
        '<div class="stat-body"><div class="stat-value">' + esc(c.value) + '</div>' +
        '<div class="stat-label">' + esc(c.label) + '</div><div class="stat-sub">' + esc(c.sub) + '</div></div>';
      grid.appendChild(cardEl);
    });
    wrap.appendChild(grid);

    /* goals + quick actions */
    var row1 = el('div', 'grid-2');
    var cGoals = card('Today\u2019s goals', 'What you planned to practice every day');
    var goalList = el('div', 'goal-list');
    var todayMinutes = function (actId) {
      return todayRecs.filter(function (r) { return r.activity === actId; }).reduce(function (a, r) { return a + (r.duration || 0); }, 0);
    };
    var todayCount = function (actId) { return todayRecs.filter(function (r) { return r.activity === actId; }).length; };
    var todayPages = function (actId) { return todayRecs.filter(function (r) { return r.activity === actId; }).reduce(function (a, r) { return a + (r.pages || 0); }, 0); };
    var rows = [
      goalRow('🎤', ACTIVITIES.speaking.color, 'Speaking', todayMinutes('speaking'), goals.speaking, 'min'),
      goalRow('💭', ACTIVITIES.think.color, 'Think in English', todayCount('think'), goals.think, 'session'),
      goalRow('🎧', ACTIVITIES.listen.color, 'Listen & Imitate', todayMinutes('listen'), goals.listen, 'min'),
      goalRow('📖', ACTIVITIES.readAloud.color, 'Read Aloud', todayPages('readAloud'), goals.readAloud, 'pages'),
      goalRow('✍️', ACTIVITIES.writing.color, 'Writing', todayCount('writing'), goals.writing, 'session'),
      goalRow('💬', ACTIVITIES.phrases.color, 'Common Phrases', pbd[today] || 0, goals.phrases, 'learned')
    ];
    rows.forEach(function (r) { goalList.appendChild(r); });
    cGoals.appendChild(goalList);
    row1.appendChild(cGoals);

    var cQuick = card('Quick actions', 'Jump straight into practice');
    var quick = el('div', 'quick-grid');
    var qs = [
      { icon: '🎤', label: 'Speak', sub: 'pick a topic, talk 10–15 min', href: '#/english/speaking' },
      { icon: '🎧', label: 'Listen & imitate', sub: 'pause, repeat, shadow', href: '#/english/listen' },
      { icon: '📖', label: 'Read aloud', sub: 'continue your material', href: '#/english/read' },
      { icon: '✍️', label: 'Write a page', sub: 'continue where you stopped', href: '#/english/write' },
      { icon: '💬', label: 'Learn 5 phrases', sub: '⏱ ' + dur.phrases + ' min · add or review', href: '#/english/phrases' },
      { icon: '💭', label: 'Think in English', sub: '⏱ ' + dur.think + ' min · inner monologue', href: '#/english/think' }
    ];
    qs.forEach(function (q) {
      var a = el('a', 'quick-btn');
      a.href = q.href;
      a.innerHTML = '<span class="q-icon">' + q.icon + '</span><span>' + esc(q.label) + '<span class="q-sub">' + esc(q.sub) + '</span></span>';
      quick.appendChild(a);
    });
    cQuick.appendChild(quick);
    row1.appendChild(cQuick);
    wrap.appendChild(row1);

    /* continue + today's records */
    var row2 = el('div', 'grid-2');
    var cContinue = card('Continue where you left off', 'Pick up exactly where you stopped');
    var contList = el('div', 'recent-list');
    var found = 0;
    (reading.materials || []).slice().reverse().forEach(function (m) {
      var chs = m.chapters || [];
      var pg = 0;
      chs.forEach(function (ch) { pg += (typeof ch.pages === 'number' ? ch.pages : (ch.pages || []).length || 1); });
      found++;
      var row = el('div', 'recent-row');
      row.innerHTML = '<div class="recent-icon" style="background:#f59e0b18">📖</div>' +
        '<div class="recent-main"><div class="recent-title">' + esc(m.title) + '</div>' +
        '<div class="recent-sub">' + chs.length + ' chapter' + (chs.length === 1 ? '' : 's') + ' · ' + pg + ' page' + (pg === 1 ? '' : 's') + '</div></div>' +
        '<div class="recent-side"><a class="btn ghost small" href="#/english/read">Continue</a></div>';
      contList.appendChild(row);
    });
    (writing.entries || []).slice().sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); }).forEach(function (x) {
      if (found >= 2) return;
      found++;
      var row = el('div', 'recent-row');
      row.innerHTML = '<div class="recent-icon" style="background:#ec489918">✍️</div>' +
        '<div class="recent-main"><div class="recent-title">' + esc(x.title) + '</div>' +
        '<div class="recent-sub">' + (x.pages || 1) + ' page' + ((x.pages || 1) === 1 ? '' : 's') + ' · ' + (x.date ? fmtDate(x.date) : '') + '</div></div>' +
        '<div class="recent-side"><a class="btn ghost small" href="#/english/write">Write</a></div>';
      contList.appendChild(row);
    });
    if (!found) contList.appendChild(el('p', 'cell-muted', 'No in-progress material — start one from Read Aloud or Writing.'));
    cContinue.appendChild(contList);
    row2.appendChild(cContinue);

    var cToday = card('Today\u2019s record', 'What did you practice today?');
    var todayList = el('div', 'recent-list');
    if (todayRecs.length) {
      sortByDateDesc(todayRecs).slice(0, 8).forEach(function (r) { todayList.appendChild(recordRow(r, null)); });
    } else {
      todayList.appendChild(el('p', 'cell-muted', 'Nothing yet. Pick a quick action above — even 10 minutes counts.'));
    }
    cToday.appendChild(todayList);
    row2.appendChild(cToday);
    wrap.appendChild(row2);

    /* trend + heatmap */
    var row3 = el('div', 'grid-2');
    var c14 = card('Last 14 days', 'Practice minutes (bars) vs phrases learned (line)');
    c14.appendChild(el('canvas', 'chart'));
    row3.appendChild(c14);
    var cHeat = card('Streak heatmap', 'Daily practice, last 15 weeks');
    var heat = el('div', null);
    buildHeatmap(heat, list);
    cHeat.appendChild(heat);
    cHeat.appendChild(el('div', 'heat-legend', 'Less <span class="hm-cell"></span><span class="hm-cell lvl1"></span><span class="hm-cell lvl2"></span><span class="hm-cell lvl3"></span> More'));
    row3.appendChild(cHeat);
    wrap.appendChild(row3);
    view.appendChild(wrap);

    var b14 = bucketize(list, 'day');
    C.comboChart(c14.querySelector('canvas'), {
      labels: b14.labels,
      bars: { values: b14.buckets.map(function (x) { return x.minutes; }), color: '#6366f1' },
      line: { values: b14.labels.map(function (_, i) { return pbd[b14.buckets[i].key] || 0; }), color: '#06b6d4', unit: ' phrases' }
    });
  }

  /* ============================================================
     VIEW: Speaking (solo / with person / with AI)
     ============================================================ */
  var speakEditId = null;
  var speakFilter = 'all';

  function speaking(view) {
    var list = getRecords().filter(function (r) { return r.activity === 'speaking'; });
    var goals = getGoals();
    var today = todayISO();
    var todayMin = list.filter(function (r) { return r.date === today; }).reduce(function (a, r) { return a + (r.duration || 0); }, 0);
    var wrap = el('div', 'view-body');
    var head = el('div', 'page-head');
    head.innerHTML = '<h1>Speaking 🎤</h1><p>Choose a simple topic and talk about it for 10–15 minutes. Solo, with a person, or with AI — all of it counts.</p>';
    wrap.appendChild(head);

    /* speaking dashboard KPIs + volume chart */
    var spStats = computeStats(list);
    var spWeek = list.filter(function (r) { return r.date >= addDays(today, -6); }).reduce(function (a, r) { return a + (r.duration || 0); }, 0);
    var spDays = Object.keys(list.reduce(function (m, r) { m[r.date] = 1; return m; }, {})).length;
    wrap.appendChild(statGrid([
      { icon: '⏱️', label: 'Total time', value: fmtMinutes(spStats.perAct.speaking.minutes), sub: list.length + ' sessions', color: '#10b981' },
      { icon: '📅', label: 'Last 7 days', value: fmtMinutes(spWeek), sub: 'this week', color: '#6366f1' },
      { icon: '🗓️', label: 'Active days', value: String(spDays), sub: 'days with speaking', color: '#8b5cf6' }
    ]));
    var spChart = card('Speaking volume', 'Minutes per day — last 14 days');
    var spCanvas = el('canvas', 'chart');
    spChart.appendChild(spCanvas);
    wrap.appendChild(spChart);

    var goalCard = card('Today\u2019s speaking goal', 'Goal: ' + goals.speaking + ' minutes per day');
    goalCard.appendChild(goalRow('🎤', ACTIVITIES.speaking.color, 'Speaking minutes', todayMin, goals.speaking, 'min'));
    wrap.appendChild(goalCard);

    var form = el('form', 'card form-card');
    form.innerHTML =
      '<h2 id="form-title">Log a speaking session</h2><div class="card-sub">Preserve the record: what you talked about matters more than the checkbox.</div>' +
      '<div class="form-grid">' +
      '  <label>Mode<select name="mode">' +
      '    <option value="solo">🎤 Solo topic talk</option>' +
      '    <option value="person">👥 With another person</option>' +
      '    <option value="ai">🤖 With AI</option>' +
      '  </select></label>' +
      '  <label>Date<input name="date" type="date" required></label>' +
      '  <label>Topic<textarea name="topic" rows="2" required placeholder="e.g. My morning routine — what I do before work"></textarea></label>' +
      '  <label>Duration (minutes)<input name="duration" type="number" min="1" max="600" required placeholder="13"></label>' +
      '  <label class="span2">How did it go?<textarea name="notes" rows="2" placeholder="e.g. I had difficulty explaining my morning activities — need more daily-routine vocabulary"></textarea></label>' +
      '  <label>Self score (0–100)<input name="score" type="number" min="0" max="100" placeholder="optional"></label>' +
      '  <label>Status<select name="status"><option value="done">Done</option><option value="partial">Partial</option></select></label>' +
      '</div>' +
      '<div class="form-actions"><button class="btn primary" type="submit">💾 Save session</button>' +
      '<button class="btn ghost" type="button" id="btn-cancel" style="display:none">Cancel edit</button></div>';
    wrap.appendChild(form);
    var speakMedia = mediaAttach(speakEditId ? (list.find(function (r) { return r.id === speakEditId; }) || {}).media : null, { accept: 'audio/*', label: 'Audio recording (optional)', kind: 'audio', multiple: true });
    form.appendChild(speakMedia.el);

    var log = el('div', 'card');
    log.appendChild(el('div', 'card-head', '<h2>Session history</h2>'));
    var seg = el('div', 'seg-control');
    [['all', 'All'], ['solo', 'Solo'], ['person', 'Person'], ['ai', 'AI']].forEach(function (f) {
      var b = el('button', speakFilter === f[0] ? 'active' : '', f[1]);
      b.addEventListener('click', function () { speakFilter = f[0]; LT.render(); });
      seg.appendChild(b);
    });
    log.querySelector('.card-head').appendChild(seg);
    var logList = el('div', 'recent-list');
    var filtered = speakFilter === 'all' ? list : list.filter(function (r) { return r.mode === speakFilter; });
    if (!filtered.length) {
      logList.appendChild(el('p', 'cell-muted', 'No sessions logged yet.'));
    } else {
      sortByDateDesc(filtered).slice(0, 40).forEach(function (r) {
        logList.appendChild(recordRow(r, {
          edit: function () { speakEditId = r.id; LT.render(); },
          del: function () {
            if (!window.confirm('Delete this speaking session?')) return;
            deleteRecord(r.id); toast('Session deleted'); LT.render();
          }
        }));
      });
    }
    log.appendChild(logList);
    wrap.appendChild(log);
    view.appendChild(wrap);

    var f = form;
    f.date.value = todayISO();
    if (speakEditId) {
      var rec = list.find(function (r) { return r.id === speakEditId; });
      if (rec) {
        f.mode.value = rec.mode || 'solo';
        f.date.value = rec.date;
        f.topic.value = rec.topic || '';
        f.duration.value = rec.duration || '';
        f.notes.value = rec.notes || '';
        f.score.value = rec.score > 0 ? rec.score : '';
        f.status.value = rec.status || 'done';
        document.getElementById('form-title').textContent = 'Edit speaking session';
        document.getElementById('btn-cancel').style.display = '';
      } else speakEditId = null;
    }
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var dur = parseInt(f.duration.value, 10);
      if (!f.date.value || !f.topic.value.trim() || !dur || dur < 1) { toast('Date, topic and duration are required'); return; }
      speakMedia.resolve(speakEditId ? (list.find(function (r) { return r.id === speakEditId; }) || {}).media : null).then(function (media) {
        var rec = {
          id: speakEditId || uid(), date: f.date.value,
          activity: 'speaking', mode: f.mode.value,
          duration: dur, topic: f.topic.value.trim(),
          notes: f.notes.value.trim(), status: f.status.value,
          score: f.score.value === '' ? 0 : Math.min(100, Math.max(0, parseInt(f.score.value, 10) || 0)),
          media: media, mediaType: (media && media.length) ? 'audio' : null,
          createdAt: Date.now()
        };
        if (speakEditId) { updateRecord(speakEditId, rec); toast('Session updated'); }
        else { addRecord(rec); toast('Session saved'); onTaskComplete('speaking'); }
        speakEditId = null;
        LT.render();
      });
    });
    document.getElementById('btn-cancel').addEventListener('click', function () { speakEditId = null; LT.render(); });

    var spB = bucketize(list, 'day');
    C.barChart(spCanvas, {
      labels: spB.labels,
      values: spB.buckets.map(function (x) { return x.minutes; }),
      color: '#10b981',
      format: function (v) { return fmtMinutes(v); }
    });
  }

  /* ============================================================
     VIEW: Think in English
     ============================================================ */
  var thinkEditId = null;

  function think(view) {
    var list = getRecords().filter(function (r) { return r.activity === 'think'; });
    var today = todayISO();
    var wrap = el('div', 'view-body');
    var dur = getDurations();
    var head = el('div', 'page-head');
    head.innerHTML = '<h1>Think in English 💭</h1><p class="head-dur">⏱️ ' + dur.think + ' min</p><p>Run a quick inner monologue about your day in English. No pressure — just describe what you see, do, and feel.</p>';
    wrap.appendChild(head);

    /* think dashboard KPIs + frequency chart */
    var thWeek = list.filter(function (r) { return r.date >= addDays(today, -6); }).length;
    var thDays = Object.keys(list.reduce(function (m, r) { m[r.date] = 1; return m; }, {})).length;
    var thStreak = computeStreak(list);
    wrap.appendChild(statGrid([
      { icon: '💭', label: 'Total sessions', value: String(list.length), sub: 'inner monologues', color: '#8b5cf6' },
      { icon: '📅', label: 'Last 7 days', value: String(thWeek), sub: 'sessions this week', color: '#6366f1' },
      { icon: '🔥', label: 'Streak', value: thStreak + ' day' + (thStreak === 1 ? '' : 's'), sub: 'consecutive days', color: '#f59e0b' },
      { icon: '🗓️', label: 'Active days', value: String(thDays), sub: 'days with thinking', color: '#10b981' }
    ]));
    var thChart = card('Thinking frequency', 'Sessions per day — last 14 days');
    var thCanvas = el('canvas', 'chart');
    thChart.appendChild(thCanvas);
    wrap.appendChild(thChart);

    var todayEntry = list.filter(function (r) { return r.date === today; }).length;
    var todayMins = list.filter(function (r) { return r.date === today; }).reduce(function (a, r) { return a + (r.duration || 0); }, 0);
    var goalCard = card('Today', 'Goal: think in English once a day' + (todayMins ? ' · ' + todayMins + ' min today' : ''));
    goalCard.appendChild(goalRow('💭', ACTIVITIES.think.color, 'Think in English', todayEntry, 1, 'session'));
    wrap.appendChild(goalCard);

    var form = el('form', 'card form-card');
    form.innerHTML =
      '<h2 id="form-title">Log today\u2019s thinking</h2>' +
      '<div class="form-grid">' +
      '  <label>Date<input name="date" type="date" required></label>' +
      '  <label>Minutes spent<input name="duration" type="number" min="0" max="600" placeholder="optional"></label>' +
      '  <label>Situation<textarea name="topic" rows="2" required placeholder="e.g. Thinking about my to-do list while making coffee"></textarea></label>' +
      '  <label class="span2">What did you manage to express?<textarea name="notes" rows="2" placeholder="e.g. Could describe the steps easily, but struggled with \u201cboiling water\u201d — kettle?"></textarea></label>' +
      '  <label>Status<select name="status"><option value="done">Done — I thought in English</option><option value="partial">Partly</option></select></label>' +
      '</div>' +
      '<div class="form-actions"><button class="btn primary" type="submit">💾 Save</button>' +
      '<button class="btn ghost" type="button" id="btn-cancel" style="display:none">Cancel edit</button></div>';
    wrap.appendChild(form);

    var log = el('div', 'card');
    log.appendChild(el('h2', null, 'History'));
    var logList = el('div', 'recent-list');
    if (!list.length) logList.appendChild(el('p', 'cell-muted', 'No thinking entries yet.'));
    else sortByDateDesc(list).slice(0, 30).forEach(function (r) {
      logList.appendChild(recordRow(r, {
        edit: function () { thinkEditId = r.id; LT.render(); },
        del: function () {
          if (!window.confirm('Delete this entry?')) return;
          deleteRecord(r.id); toast('Entry deleted'); LT.render();
        }
      }));
    });
    log.appendChild(logList);
    wrap.appendChild(log);
    view.appendChild(wrap);

    var f = form;
    f.date.value = todayISO();
    if (thinkEditId) {
      var rec = list.find(function (r) { return r.id === thinkEditId; });
      if (rec) {
        f.date.value = rec.date; f.topic.value = rec.topic || '';
        f.notes.value = rec.notes || ''; f.status.value = rec.status || 'done';
        f.duration.value = rec.duration || '';
        document.getElementById('form-title').textContent = 'Edit entry';
        document.getElementById('btn-cancel').style.display = '';
      } else thinkEditId = null;
    }
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      if (!f.date.value || !f.topic.value.trim()) { toast('Situation is required'); return; }
      var rec = {
        id: thinkEditId || uid(), date: f.date.value, activity: 'think',
        topic: f.topic.value.trim(), notes: f.notes.value.trim(),
        status: f.status.value, duration: Math.max(0, parseInt(f.duration.value, 10) || 0), createdAt: Date.now()
      };
      if (thinkEditId) { updateRecord(thinkEditId, rec); toast('Entry updated'); }
      else { addRecord(rec); toast('Saved'); onTaskComplete('think'); }
      thinkEditId = null;
      LT.render();
    });
    document.getElementById('btn-cancel').addEventListener('click', function () { thinkEditId = null; LT.render(); });

    var thB = bucketize(list, 'day');
    C.barChart(thCanvas, { labels: thB.labels, values: thB.buckets.map(function (x) { return x.count; }), color: '#8b5cf6', format: function (v) { return String(Math.round(v)); } });
  }

  /* ============================================================
     VIEW: Listen & Imitate
     ============================================================ */
  var listenEditId = null;

  function listen(view) {
    var list = getRecords().filter(function (r) { return r.activity === 'listen'; });
    var goals = getGoals();
    var today = todayISO();
    var todayMin = list.filter(function (r) { return r.date === today; }).reduce(function (a, r) { return a + (r.duration || 0); }, 0);
    var wrap = el('div', 'view-body');
    var head = el('div', 'page-head');
    head.innerHTML = '<h1>Listen & Imitate 🎧</h1><p>Listen to English audio or video, pause, and repeat what you heard. Shadowing builds pronunciation and rhythm.</p>';
    wrap.appendChild(head);

    /* listen dashboard KPIs + volume chart */
    var liStats = computeStats(list);
    var liWeek = list.filter(function (r) { return r.date >= addDays(today, -6); }).reduce(function (a, r) { return a + (r.duration || 0); }, 0);
    var liDays = Object.keys(list.reduce(function (m, r) { m[r.date] = 1; return m; }, {})).length;
    wrap.appendChild(statGrid([
      { icon: '⏱️', label: 'Total time', value: fmtMinutes(liStats.perAct.listen.minutes), sub: list.length + ' sessions', color: '#6366f1' },
      { icon: '📅', label: 'Last 7 days', value: fmtMinutes(liWeek), sub: 'this week', color: '#8b5cf6' },
      { icon: '🗓️', label: 'Active days', value: String(liDays), sub: 'days with listening', color: '#f59e0b' }
    ]));
    var liChart = card('Listening volume', 'Minutes per day — last 14 days');
    var liCanvas = el('canvas', 'chart');
    liChart.appendChild(liCanvas);
    wrap.appendChild(liChart);

    var goalCard = card('Today\u2019s goal', 'Goal: ' + goals.listen + ' minutes per day');
    goalCard.appendChild(goalRow('🎧', ACTIVITIES.listen.color, 'Listening minutes', todayMin, goals.listen, 'min'));
    wrap.appendChild(goalCard);

    var form = el('form', 'card form-card');
    form.innerHTML =
      '<h2 id="form-title">Log a listening session</h2>' +
      '<div class="form-grid">' +
      '  <label>Date<input name="date" type="date" required></label>' +
      '  <label>Material<textarea name="topic" rows="2" required placeholder="e.g. BBC 6 Minute English — \u201cWhy we forget\u201d"></textarea></label>' +
      '  <label>Duration (minutes)<input name="duration" type="number" min="1" max="600" required placeholder="20"></label>' +
      '  <label>What did you imitate?<textarea name="notes" rows="2" placeholder="e.g. Shadowed the presenter\u2019s intonation on question sentences"></textarea></label>' +
      '  <label>Self score (0–100)<input name="score" type="number" min="0" max="100" placeholder="optional"></label>' +
      '  <label>Status<select name="status"><option value="done">Done</option><option value="partial">Partial</option></select></label>' +
      '</div>' +
      '<div class="form-actions"><button class="btn primary" type="submit">💾 Save session</button>' +
      '<button class="btn ghost" type="button" id="btn-cancel" style="display:none">Cancel edit</button></div>';
    wrap.appendChild(form);
    var listenMedia = mediaAttach(listenEditId ? (list.find(function (r) { return r.id === listenEditId; }) || {}).media : null, { accept: 'audio/*', label: 'Audio recording (optional)', kind: 'audio', multiple: true });
    form.appendChild(listenMedia.el);

    var log = el('div', 'card');
    log.appendChild(el('h2', null, 'Session history'));
    var logList = el('div', 'recent-list');
    if (!list.length) logList.appendChild(el('p', 'cell-muted', 'No listening sessions yet.'));
    else sortByDateDesc(list).slice(0, 40).forEach(function (r) {
      logList.appendChild(recordRow(r, {
        edit: function () { listenEditId = r.id; LT.render(); },
        del: function () {
          if (!window.confirm('Delete this listening session?')) return;
          deleteRecord(r.id); toast('Session deleted'); LT.render();
        }
      }));
    });
    log.appendChild(logList);
    wrap.appendChild(log);
    view.appendChild(wrap);

    var f = form;
    f.date.value = todayISO();
    if (listenEditId) {
      var rec = list.find(function (r) { return r.id === listenEditId; });
      if (rec) {
        f.date.value = rec.date; f.topic.value = rec.topic || '';
        f.duration.value = rec.duration || '';
        f.notes.value = rec.notes || '';
        f.score.value = rec.score > 0 ? rec.score : '';
        f.status.value = rec.status || 'done';
        document.getElementById('form-title').textContent = 'Edit session';
        document.getElementById('btn-cancel').style.display = '';
      } else listenEditId = null;
    }
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var dur = parseInt(f.duration.value, 10);
      if (!f.date.value || !f.topic.value.trim() || !dur || dur < 1) { toast('Date, material and duration are required'); return; }
      listenMedia.resolve(listenEditId ? (list.find(function (r) { return r.id === listenEditId; }) || {}).media : null).then(function (media) {
        var rec = {
          id: listenEditId || uid(), date: f.date.value, activity: 'listen',
          duration: dur, topic: f.topic.value.trim(), notes: f.notes.value.trim(),
          status: f.status.value,
          score: f.score.value === '' ? 0 : Math.min(100, Math.max(0, parseInt(f.score.value, 10) || 0)),
          media: media, mediaType: (media && media.length) ? 'audio' : null,
          createdAt: Date.now()
        };
        if (listenEditId) { updateRecord(listenEditId, rec); toast('Session updated'); }
        else { addRecord(rec); toast('Session saved'); onTaskComplete('listen'); }
        listenEditId = null;
        LT.render();
      });
    });
    document.getElementById('btn-cancel').addEventListener('click', function () { listenEditId = null; LT.render(); });

    var liB = bucketize(list, 'day');
    C.barChart(liCanvas, {
      labels: liB.labels,
      values: liB.buckets.map(function (x) { return x.minutes; }),
      color: '#6366f1',
      format: function (v) { return fmtMinutes(v); }
    });
  }

  /* ============================================================
     VIEW: History (calendar + per-day records)
     ============================================================ */
  var calCursor = (function () { var n = new Date(); return { y: n.getFullYear(), m: n.getMonth() }; })();
  var selectedDay = todayISO();
  var historyEditId = null;

  function history(view) {
    var list = getRecords();
    var pbd = phrasesByDay();
    var wrap = el('div', 'view-body');
    var head = el('div', 'page-head');
    head.innerHTML = '<h1>History 🗓️</h1><p>Click any day to see exactly what you practiced — every session keeps its topic, duration and notes.</p>';
    wrap.appendChild(head);

    /* calendar */
    var calCard = el('div', 'card');
    calCard.appendChild(el('h2', null, 'Calendar'));
    var calHead = el('div', 'cal-head');
    var prev = el('button', 'cal-nav', '‹');
    var title = el('div', 'cal-title');
    var next = el('button', 'cal-nav', '›');
    prev.title = 'Previous month';
    next.title = 'Next month';
    calHead.appendChild(prev); calHead.appendChild(title); calHead.appendChild(next);
    calCard.appendChild(calHead);

    var days = dayMap(list);
    function renderCal() {
      title.textContent = new Date(calCursor.y, calCursor.m, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
      var grid = el('div', 'cal-grid');
      ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].forEach(function (d) {
        grid.appendChild(el('div', 'cal-dow', d));
      });
      var first = new Date(calCursor.y, calCursor.m, 1);
      var lead = (first.getDay() + 6) % 7;
      var daysIn = new Date(calCursor.y, calCursor.m + 1, 0).getDate();
      var today = todayISO();
      for (var i = 0; i < lead; i++) grid.appendChild(el('div', 'cal-day other', ''));
      for (var d = 1; d <= daysIn; d++) {
        var iso = calCursor.y + '-' + String(calCursor.m + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
        var cell = el('div', 'cal-day' + (iso === today ? ' today' : '') + (iso === selectedDay ? ' selected' : ''));
        cell.textContent = String(d);
        var info = days[iso];
        if (info || (pbd[iso] || 0) > 0) {
          var mins = info ? info.minutes : 0;
          var lvl = mins === 0 ? 1 : mins < 30 ? 1 : mins < 60 ? 2 : 3;
          cell.appendChild(el('span', 'cal-dot d' + lvl));
          cell.title = fmtDate(iso) + ' · ' + (info ? info.count + ' activities · ' + fmtMinutes(mins) : '') + (pbd[iso] ? ' · ' + pbd[iso] + ' phrases' : '');
        }
        cell.addEventListener('click', (function (iso2) {
          return function () { selectedDay = iso2; LT.render(); };
        })(iso));
        grid.appendChild(cell);
      }
      var old = calCard.querySelector('.cal-grid');
      if (old) old.remove();
      calCard.appendChild(grid);
    }
    prev.addEventListener('click', function () { calCursor.m--; if (calCursor.m < 0) { calCursor.m = 11; calCursor.y--; } renderCal(); });
    next.addEventListener('click', function () { calCursor.m++; if (calCursor.m > 11) { calCursor.m = 0; calCursor.y++; } renderCal(); });
    wrap.appendChild(calCard);

    /* day records */
    var dayCard = el('div', 'card');
    var dayHead = el('div', 'card-head');
    dayHead.appendChild(el('h2', null, esc(fmtDate(selectedDay))));
    var addBtn = el('button', 'btn ghost small', '+ Add record');
    addBtn.addEventListener('click', function () {
      historyEditId = '__new__';
      LT.render();
    });
    dayHead.appendChild(addBtn);
    dayCard.appendChild(dayHead);
    dayCard.appendChild(el('div', 'card-sub', selectedDay === todayISO() ? 'Today\u2019s practice' : 'What you practiced on this day'));

    if (historyEditId) {
      var editCard = buildRecordEditForm(selectedDay);
      dayCard.appendChild(editCard);
    }

    var dayRecs = list.filter(function (r) { return r.date === selectedDay; });
    var pCount = pbd[selectedDay] || 0;
    var dayList = el('div', 'recent-list');
    if (!dayRecs.length && !pCount) {
      dayList.appendChild(el('p', 'cell-muted', 'No practice recorded on this day.'));
    } else {
      sortByDateDesc(dayRecs).forEach(function (r) {
        dayList.appendChild(recordRow(r, {
          edit: function () { historyEditId = r.id; LT.render(); },
          del: function () {
            if (!window.confirm('Delete this record?')) return;
            deleteRecord(r.id); toast('Record deleted'); LT.render();
          }
        }));
      });
      if (pCount) {
        var prow = el('div', 'recent-row');
        prow.innerHTML = '<div class="recent-icon" style="background:#06b6d418">💬</div>' +
          '<div class="recent-main"><div class="recent-title">Common Phrases</div>' +
          '<div class="recent-sub">Learned ' + pCount + ' phrase' + (pCount === 1 ? '' : 's') + ' on this day</div></div>' +
          '<div class="recent-side"><div class="v">✅</div></div>';
        dayList.appendChild(prow);
      }
    }
    dayCard.appendChild(dayList);
    wrap.appendChild(dayCard);
    view.appendChild(wrap);
    renderCal();
  }
  function buildRecordEditForm(dateVal) {
    var cardEl = el('div', 'card form-card');
    cardEl.style.marginTop = '12px';
    cardEl.innerHTML =
      '<h2>' + (historyEditId === '__new__' ? 'New record' : 'Edit record') + '</h2>' +
      '<div class="form-grid">' +
      '  <label>Date<input name="fdate" type="date" required></label>' +
      '  <label>Activity<select name="fact">' +
      ACTIVITY_IDS.map(function (a) { return '<option value="' + a + '">' + act(a).icon + ' ' + act(a).label + '</option>'; }).join('') +
      '  </select></label>' +
      '  <label>Mode (speaking)<select name="fmode">' +
      '    <option value="solo">🎤 Solo</option><option value="person">👥 Person</option><option value="ai">🤖 AI</option>' +
      '  </select></label>' +
      '  <label>Duration (min)<input name="fdur" type="number" min="0" max="600" placeholder="0"></label>' +
      '  <label class="span2">Topic / material<textarea name="ftopic" rows="2" placeholder="What did you practice?"></textarea></label>' +
      '  <label class="span2">Notes<textarea name="fnotes" rows="2" placeholder="How did it go?"></textarea></label>' +
      '  <label>Score (0–100)<input name="fscore" type="number" min="0" max="100" placeholder="optional"></label>' +
      '  <label>Status<select name="fstatus"><option value="done">Done</option><option value="partial">Partial</option></select></label>' +
      '</div>' +
      '<div class="form-actions"><button class="btn primary" id="fsave" type="button">💾 Save</button>' +
      '<button class="btn ghost" id="fcancel" type="button">Cancel</button></div>';
    var rec = null;
    if (historyEditId !== '__new__') {
      rec = getRecords().find(function (r) { return r.id === historyEditId; });
    }
    cardEl.querySelector('[name=fdate]').value = rec ? rec.date : dateVal;
    cardEl.querySelector('[name=fact]').value = rec ? rec.activity : 'speaking';
    cardEl.querySelector('[name=fmode]').value = rec && rec.mode ? rec.mode : 'solo';
    cardEl.querySelector('[name=fdur]').value = rec && rec.duration ? rec.duration : '';
    cardEl.querySelector('[name=ftopic]').value = rec ? (rec.topic || '') : '';
    cardEl.querySelector('[name=fnotes]').value = rec ? (rec.notes || '') : '';
    cardEl.querySelector('[name=fscore]').value = rec && rec.score > 0 ? rec.score : '';
    cardEl.querySelector('[name=fstatus]').value = rec ? (rec.status || 'done') : 'done';
    cardEl.querySelector('#fsave').addEventListener('click', function () {
      var q = function (n) { return cardEl.querySelector('[name=' + n + ']'); };
      var dur = parseInt(q('fdur').value, 10) || 0;
      if (!q('fdate').value || !q('ftopic').value.trim()) { toast('Date and topic are required'); return; }
      var data = {
        date: q('fdate').value, activity: q('fact').value,
        mode: q('fact').value === 'speaking' ? q('fmode').value : undefined,
        duration: dur, topic: q('ftopic').value.trim(), notes: q('fnotes').value.trim(),
        status: q('fstatus').value,
        score: q('fscore').value === '' ? 0 : Math.min(100, Math.max(0, parseInt(q('fscore').value, 10) || 0)),
        createdAt: Date.now()
      };
      if (historyEditId === '__new__') { addRecord(data); toast('Record added'); }
      else { updateRecord(historyEditId, data); toast('Record updated'); }
      historyEditId = null;
      selectedDay = data.date;
      LT.render();
    });
    cardEl.querySelector('#fcancel').addEventListener('click', function () { historyEditId = null; LT.render(); });
    return cardEl;
  }

  /* ============================================================
     VIEW: Progress
     ============================================================ */
  var progressMode = 'day';

  function progress(view) {
    var list = getRecords();
    var stats = computeStats(list);
    var goals = getGoals();
    var reading = getReading(), writing = getWriting();
    var rTot = readingTotals(reading), wTot = writingTotals(writing);
    var wrap = el('div', 'view-body');
    var head = el('div', 'page-head');
    head.innerHTML = '<h1>Progress 📈</h1><p>How much have you practiced, and are you improving?</p>';
    wrap.appendChild(head);

    if (!list.length && !getPhrases().length) {
      emptyState(wrap, 'No data yet', 'Start logging practice sessions to see progress charts.');
      view.appendChild(wrap);
      return;
    }

    var chips = el('div', 'summary-chips');
    chips.innerHTML =
      '<span class="chip">🔥 Streak <b>' + computeStreak(list) + ' days</b></span>' +
      '<span class="chip">⏱️ Total time <b>' + esc(fmtMinutes(stats.totalMinutes)) + '</b></span>' +
      '<span class="chip">🗓️ Active days <b>' + stats.activeDays + '</b></span>' +
      '<span class="chip">⭐ Avg score <b>' + (stats.avgScore != null ? stats.avgScore + '/100' : '—') + '</b></span>' +
      '<span class="chip">💬 Phrases <b>' + phrasesTotal() + '</b></span>' +
      '<span class="chip">📖 Pages read <b>' + rTot.done + '</b></span>' +
      '<span class="chip">✍️ Pages written <b>' + wTot.done + '</b></span>';
    wrap.appendChild(chips);

    var segRow = el('div', 'head-row');
    var seg = el('div', 'seg-control');
    [['day', 'Daily'], ['week', 'Weekly'], ['month', 'Monthly']].forEach(function (m) {
      var b = el('button', progressMode === m[0] ? 'active' : '', m[1]);
      b.addEventListener('click', function () { progressMode = m[0]; LT.render(); });
      seg.appendChild(b);
    });
    segRow.appendChild(seg);
    wrap.appendChild(segRow);

    var bdata = bucketize(list, progressMode);
    var labels = bdata.labels;
    var pdata = phraseBuckets(progressMode);

    /* overall learning statistics */
    var dm = dayMap(list);
    var bestDay = 0;
    Object.keys(dm).forEach(function (d) { if (dm[d].minutes > bestDay) bestDay = dm[d].minutes; });
    var thisWeekMin = list.filter(function (r) { return r.date >= addDays(todayISO(), -6); }).reduce(function (a, r) { return a + (r.duration || 0); }, 0);
    var durSessions = list.filter(function (r) { return (r.duration || 0) > 0; }).length;
    var pbdAll = phrasesByDay();
    var weekPhrases = 0;
    Object.keys(pbdAll).forEach(function (d) { if (d >= addDays(todayISO(), -6)) weekPhrases += pbdAll[d]; });
    wrap.appendChild(statGrid([
      { icon: '📝', label: 'Total sessions', value: String(list.length), sub: 'all activities', color: '#6366f1' },
      { icon: '⏱️', label: 'This week', value: fmtMinutes(thisWeekMin), sub: 'last 7 days', color: '#10b981' },
      { icon: '⚡', label: 'Best day', value: fmtMinutes(bestDay), sub: 'most in one day', color: '#f59e0b' },
      { icon: '📈', label: 'Avg session', value: durSessions ? fmtMinutes(Math.round(stats.totalMinutes / durSessions)) : '—', sub: 'per timed session', color: '#8b5cf6' },
      { icon: '💬', label: 'Phrases this week', value: String(weekPhrases), sub: 'last 7 days', color: '#06b6d4' },
      { icon: '🗓️', label: 'Active days', value: String(stats.activeDays), sub: 'days with practice', color: '#ec4899' }
    ]));

    var cTime = card('Practice time', 'Minutes per ' + progressMode);
    cTime.appendChild(el('canvas', 'chart'));
    wrap.appendChild(cTime);

    var cPhrases = card('Phrases learned', 'New phrases per ' + progressMode);
    cPhrases.appendChild(el('canvas', 'chart'));
    wrap.appendChild(cPhrases);

    var row2 = el('div', 'grid-2');
    var cActs = card('Time by skill', 'Where your minutes actually go');
    var actList = el('div', 'goal-list');
    var totalMin = stats.totalMinutes || 1;
    ACTIVITY_IDS.forEach(function (a) {
      var pa = stats.perAct[a];
      var pct = Math.round(pa.minutes / totalMin * 100);
      var g = goalBar(pa.minutes, Math.max(1, Math.round(totalMin * 0.2)), act(a).color);
      g.querySelector('.goal-name').textContent = act(a).label;
      g.querySelector('.goal-meta').innerHTML = '<b>' + fmtMinutes(pa.minutes) + '</b> · ' + pct + '%';
      actList.appendChild(g);
    });
    cActs.appendChild(actList);
    row2.appendChild(cActs);

    var cDonut = card('Activity mix', 'Share of practice time');
    cDonut.appendChild(el('canvas', 'chart donut'));
    cDonut.appendChild(el('div', 'legend', legendHTML(ACTIVITY_IDS.map(function (a) {
      return { label: act(a).label, value: stats.perAct[a].minutes, color: act(a).color };
    }))));
    row2.appendChild(cDonut);
    wrap.appendChild(row2);

    view.appendChild(wrap);

    C.barChart(cTime.querySelector('canvas'), {
      labels: labels,
      values: bdata.buckets.map(function (x) { return x.minutes; }),
      color: '#6366f1',
      format: function (v) { return fmtMinutes(v); }
    });

    C.donutChart(cDonut.querySelector('canvas'), {
      segments: ACTIVITY_IDS.filter(function (a) { return stats.perAct[a].minutes > 0; })
        .map(function (a) { return { label: act(a).label, value: stats.perAct[a].minutes, color: act(a).color }; })
        .sort(function (a, b) { return b.value - a.value; }),
      centerValue: fmtMinutes(stats.totalMinutes),
      centerLabel: 'total'
    });
    C.barChart(cPhrases.querySelector('canvas'), {
      labels: pdata.labels,
      values: pdata.buckets.map(function (x) { return x.count; }),
      color: '#06b6d4',
      format: function (v) { return String(Math.round(v)); }
    });
  }
  function matRow(title, type, done, total, id, href) {
    var row = el('div', 'mat-card');
    var emoji = type === 'writing' ? '✍️' : '📖';
    var pct = total ? Math.round(done / total * 100) : 0;
    row.innerHTML =
      '<div class="mat-emoji">' + emoji + '</div>' +
      '<div class="mat-main"><div class="mat-title">' + esc(title) + '</div>' +
      '<div class="mat-meta">' + done + ' / ' + total + ' pages completed</div>' +
      '<div class="mat-track"><div class="goal-fill" style="width:' + pct + '%"></div></div></div>' +
      '<div class="mat-actions"><a class="btn ghost small" href="' + href + '">Open</a></div>';
    return row;
  }

  /* ============================================================
     VIEW: Settings
     ============================================================ */
  function settings(view) {
    var goals = getGoals();
    var wrap = el('div', 'view-body');
    var head = el('div', 'page-head');
    head.innerHTML = '<h1>Settings ⚙️</h1><p>Your daily goals and your data.</p>';
    wrap.appendChild(head);

    var gCard = el('div', 'card');
    gCard.appendChild(el('h2', null, 'Daily goals'));
    gCard.appendChild(el('div', 'card-sub', 'These drive the goal bars on the dashboard.'));
    var setGrid = el('div', 'set-grid');
    ACTIVITY_IDS.forEach(function (a) {
      var lab = act(a).label;
      var f = el('div', 'set-field');
      f.innerHTML = '<label>' + esc(lab) + ' (' + act(a).unit + ')<input type="number" min="0" max="600" data-goal="' + a + '"></label>';
      f.querySelector('input').value = goals[a];
      setGrid.appendChild(f);
    });
    var saveBtn = el('button', 'btn primary', '💾 Save goals');
    saveBtn.addEventListener('click', function () {
      var g = {};
      setGrid.querySelectorAll('input').forEach(function (inp) {
        g[inp.getAttribute('data-goal')] = Math.max(0, parseInt(inp.value, 10) || 0);
      });
      saveGoals(g);
      toast('Goals saved');
      LT.render();
    });
    gCard.appendChild(setGrid);
    gCard.appendChild(el('div', 'form-actions', null)).appendChild(saveBtn);
    wrap.appendChild(gCard);

    var durCard = el('div', 'card');
    durCard.appendChild(el('h2', null, 'Task durations'));
    durCard.appendChild(el('div', 'card-sub', 'How long each task is expected to take — shown as the ⏱ minutes indicator on its module.'));
    var durGrid = el('div', 'set-grid');
    var durations = getDurations();
    var durKeys = [
      { key: 'think', label: 'Think in English', icon: '💭' },
      { key: 'phrases', label: 'Common Phrases', icon: '💬' }
    ];
    durKeys.forEach(function (dk) {
      var df = el('div', 'set-field');
      df.innerHTML = '<label>' + dk.icon + ' ' + esc(dk.label) + ' (min)<input type="number" min="0" max="600" data-dur="' + dk.key + '"></label>';
      df.querySelector('input').value = durations[dk.key];
      durGrid.appendChild(df);
    });
    var durSave = el('button', 'btn primary', '💾 Save durations');
    durSave.addEventListener('click', function () {
      var d2 = {};
      durGrid.querySelectorAll('input').forEach(function (inp) {
        d2[inp.getAttribute('data-dur')] = Math.max(0, parseInt(inp.value, 10) || 0);
      });
      saveDurations(d2);
      toast('Durations saved');
      LT.render();
    });
    durCard.appendChild(durGrid);
    durCard.appendChild(el('div', 'form-actions', null)).appendChild(durSave);
    wrap.appendChild(durCard);

    var dCard = el('div', 'card');
    dCard.appendChild(el('h2', null, 'Data'));
    dCard.appendChild(el('div', 'card-sub', 'Everything is stored locally in your browser. Export a backup, import one, or start fresh.'));
    var toolsRow = el('div', 'tools-row');
    var bExport = el('button', 'btn ghost small', '⬇️ Export JSON');
    var bImport = el('button', 'btn ghost small', '⬆️ Import JSON');
    var bClear = el('button', 'btn danger small', '🗑️ Clear all data');
    var fileInput = el('input', null);
    fileInput.type = 'file';
    fileInput.accept = 'application/json,.json';
    fileInput.style.display = 'none';
    toolsRow.appendChild(bExport); toolsRow.appendChild(bImport); toolsRow.appendChild(bClear);
    dCard.appendChild(toolsRow);
    dCard.appendChild(fileInput);
    wrap.appendChild(dCard);

    var aCard = el('div', 'card');
    aCard.appendChild(el('h2', null, 'About & AI-ready design'));
    aCard.appendChild(el('p', 'about-line', 'LifeTrack keeps a real learning record: topics, durations, notes and scores — not just checkboxes.'));
    aCard.appendChild(el('p', 'about-line', 'Future AI features (grammar correction, writing feedback, pronunciation check, daily task suggestions, weekly reports) can plug into the existing data layer without redesign.'));
    wrap.appendChild(aCard);

    if (window.LTEnglish.sync && window.LTEnglish.sync.renderSettings) window.LTEnglish.sync.renderSettings(wrap);
    view.appendChild(wrap);

    bExport.addEventListener('click', function () {
      var payload = {
        app: 'lifetrack-english', version: 2, exportedAt: new Date().toISOString(),
        records: getRecords(), reading: getReading(), writing: getWriting(),
        phrases: getPhrases(), settings: { goals: getGoals(), durations: getDurations() }
      };
      var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'lifetrack-english-' + todayISO() + '.json';
      document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 400);
      toast('Backup downloaded');
    });
    fileInput.addEventListener('change', function () {
      var file = fileInput.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var data = JSON.parse(reader.result);
          var records = Array.isArray(data) ? data : (data.records || []);
          var reading = (data && data.reading) || { entries: [] };
          var writing = (data && data.writing) || { entries: [] };
          var phrases = (data && data.phrases) || [];
          var settings = (data && data.settings) || {};
          if (!window.confirm('Replace current data (' + getRecords().length + ' records, ' + getPhrases().length + ' phrases) with the imported backup?')) return;
          saveRecords(records); saveReading(reading); saveWriting(writing);
          savePhrases(phrases);
          var goalsIn = (settings.goals && typeof settings.goals === 'object') ? settings.goals : settings;
          saveGoals(Object.assign({}, DEFAULT_GOALS, goalsIn));
          if (settings.durations && typeof settings.durations === 'object') saveDurations(settings.durations);

          toast('Backup imported');
          LT.render();
        } catch (err) {
          toast('Import failed — not a valid LifeTrack backup');
        }
      };
      reader.readAsText(file);
      fileInput.value = '';
    });
    bClear.addEventListener('click', function () {
      if (!window.confirm('Delete ALL records, materials, phrases and settings? This cannot be undone.')) return;
      saveRecords([]); saveReading({ materials: [] }); saveWriting({ entries: [] });
      savePhrases([]); clearSettings();
      toast('All data cleared');
      LT.render();
    });
  }

  /* ============================================================
     Demo data
     ============================================================ */
  /* ---------------- Media attachment helpers (optional) ---------------- */
  function fileToDataUrl(file, maxBytes) {
    return new Promise(function (resolve, reject) {
      if (!file) { resolve(null); return; }
      if (maxBytes && file.size > maxBytes) { reject(new Error('File too large — max ' + Math.round(maxBytes / 1024 / 1024) + ' MB')); return; }
      var fr = new FileReader();
      fr.onload = function () { resolve(fr.result); };
      fr.onerror = function () { reject(new Error('Could not read file')); };
      fr.readAsDataURL(file);
    });
  }
  function compressImage(file, maxDim, quality) {
    return new Promise(function (resolve, reject) {
      if (!file) { resolve(null); return; }
      if (file.type.indexOf('image') !== 0) { reject(new Error('Not an image file')); return; }
      var fr = new FileReader();
      fr.onload = function () {
        var img = new Image();
        img.onload = function () {
          var scale = Math.min(1, maxDim / Math.max(img.width, img.height));
          if (scale === 1 && file.size <= 300 * 1024) { resolve(fr.result); return; }
          var w = Math.max(1, Math.round(img.width * scale));
          var h = Math.max(1, Math.round(img.height * scale));
          var cv = document.createElement('canvas');
          cv.width = w; cv.height = h;
          cv.getContext('2d').drawImage(img, 0, 0, w, h);
          try { resolve(cv.toDataURL('image/jpeg', quality || 0.72)); }
          catch (e) { resolve(fr.result); }
        };
        img.onerror = function () { reject(new Error('Could not read image')); };
        img.src = fr.result;
      };
      fr.onerror = function () { reject(new Error('Could not read file')); };
      fr.readAsDataURL(file);
    });
  }
  function mediaAttach(current, opts) {
    /* Media attach: single (default) or multiple (opts.multiple) */
    var multi = !!opts.multiple;
    var wrap2 = el('div', 'media-attach');
    var state = multi
      ? { items: Array.isArray(current) ? current.slice() : (current ? [current] : []) }
      : { value: current || null, removed: false };

    var tiles = el('div', 'media-tiles');
    var row = el('div', 'media-row');
    var addBtn = el('label', 'btn ghost small media-add', opts.kind === 'photo' ? (multi ? '📷 Add photos' : '📷 Add photo') : (multi ? '🎤 Add recordings' : '🎤 Add audio'));
    var input = el('input', null);
    input.type = 'file';
    input.accept = opts.accept || '*/*';
    input.multiple = multi;
    input.style.display = 'none';
    addBtn.appendChild(input);
    row.appendChild(addBtn);
    var hintText = opts.hint || (opts.kind === 'photo'
      ? (multi ? 'Optional — attach one or more photos' : 'Optional — attach a photo')
      : (multi ? 'Optional — attach one or more recordings' : 'Optional — attach a recording'));
    var hint = el('span', 'media-hint', hintText);
    row.appendChild(hint);

    function renderTile(url, idx, label) {
      var tile = el('div', 'media-tile');
      if (opts.kind === 'photo') {
        var im = el('img', null);
        im.src = url;
        im.alt = 'Attached photo';
        tile.appendChild(im);
        var meta = el('div', 'media-meta');
        meta.appendChild(el('div', 'media-name', label));
        meta.appendChild(el('div', 'media-sub', 'Saved with this entry'));
        tile.appendChild(meta);
      } else {
        var au = el('audio', null);
        au.controls = true;
        au.src = url;
        tile.appendChild(au);
        var meta2 = el('div', 'media-meta');
        meta2.appendChild(el('div', 'media-name', label));
        meta2.appendChild(el('div', 'media-sub', 'Saved with this entry'));
        tile.appendChild(meta2);
      }
      var rm = el('button', 'btn danger small', '✕');
      rm.type = 'button';
      rm.title = 'Remove';
      rm.addEventListener('click', function () {
        if (multi) { state.items.splice(idx, 1); } else { state.value = null; state.removed = true; }
        render();
      });
      tile.appendChild(rm);
      return tile;
    }

    function render() {
      tiles.innerHTML = '';
      if (multi) {
        state.items.forEach(function (url, i) {
          tiles.appendChild(renderTile(url, i, (opts.kind === 'photo' ? 'Photo ' : 'Audio ') + (i + 1)));
        });
      } else if (state.value) {
        tiles.appendChild(renderTile(state.value, 0, opts.kind === 'photo' ? 'Photo' : 'Audio recording'));
      }
    }
    render();

    input.addEventListener('change', function () {
      var files = Array.prototype.slice.call(input.files || []);
      if (!files.length) return;
      var job = function (fl) { return opts.kind === 'photo' ? compressImage(fl, 1280, 0.72) : fileToDataUrl(fl, (opts.maxBytes || 2) * 1024 * 1024); };
      if (multi) {
        Promise.all(files.map(function (fl) { return job(fl).catch(function () { return null; }); }))
          .then(function (urls) {
            var ok = urls.filter(Boolean);
            state.items = state.items.concat(ok);
            input.value = '';
            render();
            if (ok.length < files.length) toast('Some files were skipped (could not be read)');
          });
      } else {
        job(files[0]).then(function (url) { state.value = url; state.removed = false; })
          .catch(function (err) { toast(err.message || 'Could not read file'); })
          .then(function () { input.value = ''; render(); });
      }
    });

    wrap2.appendChild(tiles);
    wrap2.appendChild(row);
    return {
      el: wrap2,
      resolve: function (previous) {
        if (multi) return Promise.resolve(state.items.slice());
        if (state.removed) return Promise.resolve(null);
        if (state.value) return Promise.resolve(state.value);
        return Promise.resolve(previous || null);
      }
    };
  }
  /* Compact per-row media bar (list views): photo/audio attach with inline preview */
  function rowMediaBar(opts) {
    var bar = el('div', 'row-media-bar');
    var state = {
      photos: Array.isArray(opts.photos) ? opts.photos.slice() : (opts.photos ? [opts.photos] : []),
      audios: Array.isArray(opts.audios) ? opts.audios.slice() : (opts.audios ? [opts.audios] : [])
    };
    function fire() { opts.onChange({ photos: state.photos.slice(), audios: state.audios.slice() }); }
    function addBtn(label, kind, accept) {
      var b = el('label', 'btn ghost small row-media-add', label);
      var inp = el('input', null);
      inp.type = 'file';
      inp.accept = accept;
      inp.multiple = true;
      inp.style.display = 'none';
      b.appendChild(inp);
      inp.addEventListener('change', function () {
        var files = Array.prototype.slice.call(inp.files || []);
        if (!files.length) return;
        var jobs = files.map(function (fl) {
          var p = kind === 'photo' ? compressImage(fl, 1280, 0.72) : fileToDataUrl(fl, 2 * 1024 * 1024);
          return p.catch(function () { return null; });
        });
        Promise.all(jobs).then(function (urls) {
          var ok = urls.filter(Boolean);
          if (kind === 'photo') state.photos = state.photos.concat(ok); else state.audios = state.audios.concat(ok);
          inp.value = '';
          render();
          fire();
          if (ok.length < files.length) toast('Some files were skipped (could not be read)');
        });
      });
      return b;
    }
    function render() {
      bar.innerHTML = '';
      state.photos.forEach(function (url, i) {
        var im = el('img', 'row-media-thumb', null);
        im.src = url; im.alt = 'Photo';
        var xp = el('button', 'btn danger small', '✕');
        xp.type = 'button'; xp.title = 'Remove';
        xp.addEventListener('click', function () { state.photos.splice(i, 1); render(); fire(); });
        bar.appendChild(im); bar.appendChild(xp);
      });
      bar.appendChild(addBtn('📷 Add photos', 'photo', 'image/*'));
      if (opts.allowAudio) {
        state.audios.forEach(function (url, i) {
          var au = el('audio', 'row-media-audio', null);
          au.controls = true; au.src = url;
          var xa = el('button', 'btn danger small', '✕');
          xa.type = 'button'; xa.title = 'Remove';
          xa.addEventListener('click', function () { state.audios.splice(i, 1); render(); fire(); });
          bar.appendChild(au); bar.appendChild(xa);
        });
        bar.appendChild(addBtn('🎤 Add audio', 'audio', 'audio/*'));
      }
    }
    render();
    return bar;
  }
  /* ---------------- Public data layer (for other module files + AI features) ---------------- */
  window.LTEnglish = {
    ACTIVITIES: ACTIVITIES, ACTIVITY_IDS: ACTIVITY_IDS, SPEAK_MODES: SPEAK_MODES,
    DEFAULT_GOALS: DEFAULT_GOALS,
    REC_KEY: REC_KEY, READ_KEY: READ_KEY, WRITE_KEY: WRITE_KEY,
    PHRASE_KEY: PHRASE_KEY, SET_KEY: SET_KEY, 
    act: act,
    getRecords: getRecords, saveRecords: saveRecords,
    addRecord: addRecord, updateRecord: updateRecord, deleteRecord: deleteRecord,
    upsertRefRecord: upsertRefRecord, sortByDateDesc: sortByDateDesc,
    getReading: getReading, saveReading: saveReading,
    getWriting: getWriting, saveWriting: saveWriting,
    getPhrases: getPhrases, savePhrases: savePhrases,
    getGoals: getGoals, saveGoals: saveGoals, getDurations: getDurations, saveDurations: saveDurations,
    onTaskComplete: onTaskComplete,
    wordCount: wordCount, pageLabel: pageLabel,
    readingTotals: readingTotals, writingTotals: writingTotals,
    computeStats: computeStats, computeStreak: computeStreak,
    bucketize: bucketize, dayMap: dayMap, phrasesByDay: phrasesByDay, phrasesTotal: phrasesTotal,
    phraseBuckets: phraseBuckets, seriesBuckets: seriesBuckets,
    ui: { card: card, emptyState: emptyState, statusChip: statusChip, scoreChip: scoreChip, goalRow: goalRow, recordRow: recordRow, buildHeatmap: buildHeatmap, legendHTML: legendHTML, statGrid: statGrid },
    media: { fileToDataUrl: fileToDataUrl, compressImage: compressImage, mediaAttach: mediaAttach, rowMediaBar: rowMediaBar }
  };

  /* ---------------- Register module ---------------- */
  LT.registerModule({
    id: 'english',
    name: 'English Learning',
    icon: '📚',
    tabs: [
      { id: 'dashboard', label: 'Dashboard', icon: '🏠' },
      { id: 'speaking', label: 'Speaking', icon: '🎤' },
      { id: 'think', label: 'Think in English', icon: '💭' },
      { id: 'listen', label: 'Listen & Imitate', icon: '🎧' },
      { id: 'read', label: 'Read Aloud', icon: '📖' },
      { id: 'write', label: 'Writing', icon: '✍️' },
      { id: 'phrases', label: 'Common Phrases', icon: '💬' },
      { id: 'history', label: 'History', icon: '🗓️' },
      { id: 'progress', label: 'Progress', icon: '📈' },
      { id: 'settings', label: 'Settings', icon: '⚙️' }
    ],
    views: {
      dashboard: dashboard, speaking: speaking, think: think, listen: listen,
      history: history, progress: progress, settings: settings
    }
  });
})();
