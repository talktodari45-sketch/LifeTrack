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
  var SEED_KEY = 'english.seeded';

  var ACTIVITIES = {
    speaking:  { label: 'Speaking',         icon: '🎤', color: '#10b981', goal: 15, unit: 'min' },
    think:     { label: 'Think in English', icon: '💭', color: '#8b5cf6', goal: 1,  unit: 'session' },
    listen:    { label: 'Listen & Imitate', icon: '🎧', color: '#6366f1', goal: 15, unit: 'min' },
    readAloud: { label: 'Read Aloud',       icon: '📖', color: '#f59e0b', goal: 10, unit: 'min' },
    writing:   { label: 'Writing',          icon: '✍️', color: '#ec4899', goal: 1,  unit: 'session' },
    phrases:   { label: 'Common Phrases',   icon: '💬', color: '#06b6d4', goal: 5,  unit: 'phrases' }
  };
  var ACTIVITY_IDS = Object.keys(ACTIVITIES);
  var SPEAK_MODES = {
    solo:   { label: 'Solo topic talk',     icon: '🎤' },
    person: { label: 'With another person', icon: '👥' },
    ai:     { label: 'With AI',             icon: '🤖' }
  };
  var DEFAULT_GOALS = { speaking: 15, think: 1, listen: 15, readAloud: 10, writing: 1, phrases: 5 };

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
  function getReading() { return Store.get(READ_KEY, { materials: [] }); }
  function saveReading(d) { Store.set(READ_KEY, d); notifyChange(); }
  function getWriting() { return Store.get(WRITE_KEY, { materials: [] }); }
  function saveWriting(d) { Store.set(WRITE_KEY, d); notifyChange(); }
  function getPhrases() { return Store.get(PHRASE_KEY, []); }
  function savePhrases(list) { Store.set(PHRASE_KEY, list); notifyChange(); }
  function getGoals() { return Object.assign({}, DEFAULT_GOALS, Store.get(SET_KEY, {})); }
  function saveGoals(g) { Store.set(SET_KEY, g); }

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
    var total = 0, done = 0, inProgress = 0, practicedTimes = 0, minutes = 0;
    (reading.materials || []).forEach(function (m) {
      (m.chapters || []).forEach(function (ch) {
        (ch.pages || []).forEach(function (p) {
          total++;
          if (p.status === 'completed') done++;
          else if (p.status === 'in-progress') inProgress++;
          practicedTimes += p.practiced || 0;
          minutes += p.totalMinutes || 0;
        });
      });
    });
    return { total: total, done: done, inProgress: inProgress, practicedTimes: practicedTimes, minutes: minutes };
  }
  function writingTotals(writing) {
    var total = 0, done = 0, inProgress = 0, words = 0;
    (writing.materials || []).forEach(function (m) {
      (m.pages || []).forEach(function (p) {
        total++;
        if (p.status === 'completed') done++;
        else if (p.status === 'in-progress') inProgress++;
        words += p.wordCount || 0;
      });
    });
    return { total: total, done: done, inProgress: inProgress, words: words };
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
      if (p.learned) m[p.learned] = (m[p.learned] || 0) + 1;
    });
    return m;
  }

  /* ---------------- Shared UI ---------------- */
  function card(title, sub) {
    var c = el('div', 'card');
    c.appendChild(el('h2', null, esc(title)));
    if (sub) c.appendChild(el('div', 'card-sub', esc(sub)));
    return c;
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
    if (r.duration) sideParts.push(esc(fmtMinutes(r.duration)));
    if (r.score > 0) sideParts.push(esc(String(r.score)) + '/100');
    row.innerHTML =
      '<div class="recent-icon" style="background:' + a.color + '18">' + a.icon + '</div>' +
      '<div class="recent-main"><div class="recent-title">' + esc(a.label + modeTxt) +
      (r.status === 'partial' ? ' <span class="st-chip st-in-progress">partial</span>' : '') +
      '</div><div class="recent-sub">' + esc(fmtDate(r.date)) + (sub ? ' · ' + sub : '') + '</div></div>' +
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
    seedDemo(false);
    var list = getRecords();
    var stats = computeStats(list);
    var streak = computeStreak(list);
    var goals = getGoals();
    var today = todayISO();
    var todayRecs = list.filter(function (r) { return r.date === today; });
    var pbd = phrasesByDay();
    var reading = getReading(), writing = getWriting();
    var rTot = readingTotals(reading), wTot = writingTotals(writing);

    var wrap = el('div', 'view-body');
    var hour = new Date().getHours();
    var greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
    var head = el('div', 'page-head');
    head.innerHTML = '<h1>' + greet + ' 👋</h1><p>' + esc(fmtDate(today)) + ' · ' +
      (todayRecs.length ? 'You practiced ' + todayRecs.length + ' activit' + (todayRecs.length === 1 ? 'y' : 'ies') + ' today — keep it up!' : 'Nothing logged yet today — 10 minutes counts.') + '</p>';
    if (window.LTEnglish.sync && window.LTEnglish.sync.renderPill) head.appendChild(window.LTEnglish.sync.renderPill());
    wrap.appendChild(head);

    if (!list.length && !getPhrases().length) {
      var demoBtn = el('button', 'btn primary', 'Load demo data');
      demoBtn.addEventListener('click', function () { seedDemo(true); toast('Demo journal loaded'); LT.render(); });
      emptyState(wrap, 'Welcome to your English journal', 'Log speaking, listening, reading, writing and phrases — every session becomes a real learning record.', [demoBtn]);
      view.appendChild(wrap);
      return;
    }

    /* stats */
    var cards = [
      { icon: '🔥', label: 'Daily streak', value: streak + ' day' + (streak === 1 ? '' : 's'), sub: streak > 0 ? 'consecutive days' : 'start today', color: '#f59e0b' },
      { icon: '⏱️', label: 'Total practice', value: fmtMinutes(stats.totalMinutes), sub: stats.activeDays + ' active days', color: '#6366f1' },
      { icon: '💬', label: 'Phrases learned', value: String(getPhrases().length), sub: 'saved phrases', color: '#06b6d4' },
      { icon: '📖', label: 'Pages read', value: rTot.done + ' / ' + rTot.total, sub: rTot.inProgress + ' in progress', color: '#f59e0b' },
      { icon: '✍️', label: 'Pages written', value: wTot.done + ' / ' + wTot.total, sub: wTot.words + ' words total', color: '#ec4899' },
      { icon: '⭐', label: 'Avg score', value: stats.avgScore != null ? stats.avgScore + '/100' : '—', sub: 'self-rated sessions', color: '#10b981' }
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
    var rows = [
      goalRow('🎤', ACTIVITIES.speaking.color, 'Speaking', todayMinutes('speaking'), goals.speaking, 'min'),
      goalRow('💭', ACTIVITIES.think.color, 'Think in English', todayCount('think'), goals.think, 'session'),
      goalRow('🎧', ACTIVITIES.listen.color, 'Listen & Imitate', todayMinutes('listen'), goals.listen, 'min'),
      goalRow('📖', ACTIVITIES.readAloud.color, 'Read Aloud', todayMinutes('readAloud'), goals.readAloud, 'min'),
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
      { icon: '💬', label: 'Learn 5 phrases', sub: 'add or review phrases', href: '#/english/phrases' },
      { icon: '💭', label: 'Think in English', sub: '2 minutes of inner monologue', href: '#/english/think' }
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
    (reading.materials || []).forEach(function (m) {
      (m.chapters || []).forEach(function (ch) {
        (ch.pages || []).forEach(function (p, pi) {
          if (p.status === 'in-progress' && found < 1) {
            found++;
            var row = el('div', 'recent-row');
            row.innerHTML = '<div class="recent-icon" style="background:#f59e0b18">📖</div>' +
              '<div class="recent-main"><div class="recent-title">' + esc(pageLabel(m, ch, p, pi)) + '</div>' +
              '<div class="recent-sub">practiced ' + (p.practiced || 0) + '× · ' + (p.totalMinutes || 0) + ' min</div></div>' +
              '<div class="recent-side"><a class="btn ghost small" href="#/english/read?mat=' + m.id + '&page=' + p.id + '">Continue</a></div>';
            contList.appendChild(row);
          }
        });
      });
    });
    (writing.materials || []).forEach(function (m) {
      (m.pages || []).forEach(function (p, pi) {
        if (p.status === 'in-progress' && found < 2) {
          found++;
          var row = el('div', 'recent-row');
          row.innerHTML = '<div class="recent-icon" style="background:#ec489918">✍️</div>' +
            '<div class="recent-main"><div class="recent-title">' + esc(m.title + ' — Page ' + (pi + 1)) + '</div>' +
            '<div class="recent-sub">' + (p.prompt ? esc(p.prompt.length > 50 ? p.prompt.slice(0, 50) + '…' : p.prompt) : '') + '</div></div>' +
            '<div class="recent-side"><a class="btn ghost small" href="#/english/write?mat=' + m.id + '&page=' + p.id + '">Write</a></div>';
          contList.appendChild(row);
        }
      });
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
      var rec = {
        id: speakEditId || uid(), date: f.date.value,
        activity: 'speaking', mode: f.mode.value,
        duration: dur, topic: f.topic.value.trim(),
        notes: f.notes.value.trim(), status: f.status.value,
        score: f.score.value === '' ? 0 : Math.min(100, Math.max(0, parseInt(f.score.value, 10) || 0)),
        createdAt: Date.now()
      };
      if (speakEditId) { updateRecord(speakEditId, rec); toast('Session updated'); }
      else { addRecord(rec); toast('Session saved'); }
      speakEditId = null;
      LT.render();
    });
    document.getElementById('btn-cancel').addEventListener('click', function () { speakEditId = null; LT.render(); });
  }

  /* ============================================================
     VIEW: Think in English
     ============================================================ */
  var thinkEditId = null;

  function think(view) {
    var list = getRecords().filter(function (r) { return r.activity === 'think'; });
    var today = todayISO();
    var wrap = el('div', 'view-body');
    var head = el('div', 'page-head');
    head.innerHTML = '<h1>Think in English 💭</h1><p>Run a quick inner monologue about your day in English. No pressure — just describe what you see, do, and feel.</p>';
    wrap.appendChild(head);

    var todayEntry = list.filter(function (r) { return r.date === today; }).length;
    var goalCard = card('Today', 'Goal: think in English once a day');
    goalCard.appendChild(goalRow('💭', ACTIVITIES.think.color, 'Think in English', todayEntry, 1, 'session'));
    wrap.appendChild(goalCard);

    var form = el('form', 'card form-card');
    form.innerHTML =
      '<h2 id="form-title">Log today\u2019s thinking</h2>' +
      '<div class="form-grid">' +
      '  <label>Date<input name="date" type="date" required></label>' +
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
        status: f.status.value, createdAt: Date.now()
      };
      if (thinkEditId) { updateRecord(thinkEditId, rec); toast('Entry updated'); }
      else { addRecord(rec); toast('Saved'); }
      thinkEditId = null;
      LT.render();
    });
    document.getElementById('btn-cancel').addEventListener('click', function () { thinkEditId = null; LT.render(); });
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
      var rec = {
        id: listenEditId || uid(), date: f.date.value, activity: 'listen',
        duration: dur, topic: f.topic.value.trim(), notes: f.notes.value.trim(),
        status: f.status.value,
        score: f.score.value === '' ? 0 : Math.min(100, Math.max(0, parseInt(f.score.value, 10) || 0)),
        createdAt: Date.now()
      };
      if (listenEditId) { updateRecord(listenEditId, rec); toast('Session updated'); }
      else { addRecord(rec); toast('Session saved'); }
      listenEditId = null;
      LT.render();
    });
    document.getElementById('btn-cancel').addEventListener('click', function () { listenEditId = null; LT.render(); });
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
      var demoBtn = el('button', 'btn primary', 'Load demo data');
      demoBtn.addEventListener('click', function () { seedDemo(true); toast('Demo journal loaded'); LT.render(); });
      emptyState(wrap, 'No data yet', 'Start logging practice sessions to see progress charts.', [demoBtn]);
      view.appendChild(wrap);
      return;
    }

    var chips = el('div', 'summary-chips');
    chips.innerHTML =
      '<span class="chip">🔥 Streak <b>' + computeStreak(list) + ' days</b></span>' +
      '<span class="chip">⏱️ Total time <b>' + esc(fmtMinutes(stats.totalMinutes)) + '</b></span>' +
      '<span class="chip">🗓️ Active days <b>' + stats.activeDays + '</b></span>' +
      '<span class="chip">⭐ Avg score <b>' + (stats.avgScore != null ? stats.avgScore + '/100' : '—') + '</b></span>' +
      '<span class="chip">💬 Phrases <b>' + getPhrases().length + '</b></span>' +
      '<span class="chip">📖 Pages read <b>' + rTot.done + '/' + rTot.total + '</b></span>' +
      '<span class="chip">✍️ Pages written <b>' + wTot.done + '/' + wTot.total + '</b></span>';
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

    var row1 = el('div', 'grid-2');
    var cTime = card('Practice time', 'Minutes per ' + progressMode);
    cTime.appendChild(el('canvas', 'chart'));
    row1.appendChild(cTime);
    var cScore = card('Score trend', 'Average self-score per ' + progressMode + ' — improvement over time');
    cScore.appendChild(el('canvas', 'chart'));
    row1.appendChild(cScore);
    wrap.appendChild(row1);

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

    /* materials progress */
    var row3 = el('div', 'grid-2');
    var cRead = card('Reading materials', 'Pages completed across your books and stories');
    var rl = el('div', 'mat-list');
    if (!(reading.materials || []).length) rl.appendChild(el('p', 'cell-muted', 'No reading materials yet.'));
    (reading.materials || []).forEach(function (m) {
      var t = 0, d = 0;
      (m.chapters || []).forEach(function (ch) { (ch.pages || []).forEach(function (p) { t++; if (p.status === 'completed') d++; }); });
      rl.appendChild(matRow(m.title, m.type, d, t, m.id, '#/english/read'));
    });
    cRead.appendChild(rl);
    row3.appendChild(cRead);

    var cWrite = card('Writing materials', 'Pages written across your writing projects');
    var wl = el('div', 'mat-list');
    if (!(writing.materials || []).length) wl.appendChild(el('p', 'cell-muted', 'No writing materials yet.'));
    (writing.materials || []).forEach(function (m) {
      var t = 0, d = 0;
      (m.pages || []).forEach(function (p) { t++; if (p.status === 'completed') d++; });
      wl.appendChild(matRow(m.title, 'writing', d, t, m.id, '#/english/write'));
    });
    cWrite.appendChild(wl);
    row3.appendChild(cWrite);
    wrap.appendChild(row3);
    view.appendChild(wrap);

    C.barChart(cTime.querySelector('canvas'), {
      labels: labels,
      values: bdata.buckets.map(function (x) { return x.minutes; }),
      color: '#6366f1',
      format: function (v) { return fmtMinutes(v); }
    });
    C.lineChart(cScore.querySelector('canvas'), {
      labels: labels,
      values: bdata.buckets.map(function (x) { return x.scores.length ? Math.round(x.scores.reduce(function (a, b) { return a + b; }, 0) / x.scores.length) : null; }),
      color: '#10b981',
      range: { min: 0, max: 100 }
    });
    C.donutChart(cDonut.querySelector('canvas'), {
      segments: ACTIVITY_IDS.filter(function (a) { return stats.perAct[a].minutes > 0; })
        .map(function (a) { return { label: act(a).label, value: stats.perAct[a].minutes, color: act(a).color }; })
        .sort(function (a, b) { return b.value - a.value; }),
      centerValue: fmtMinutes(stats.totalMinutes),
      centerLabel: 'total'
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
      f.innerHTML = '<label>' + esc(lab) + '<input type="number" min="0" max="600" data-goal="' + a + '"></label>';
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

    var dCard = el('div', 'card');
    dCard.appendChild(el('h2', null, 'Data'));
    dCard.appendChild(el('div', 'card-sub', 'Everything is stored locally in your browser. Export a backup, import one, or start fresh.'));
    var toolsRow = el('div', 'tools-row');
    var bExport = el('button', 'btn ghost small', '⬇️ Export JSON');
    var bImport = el('button', 'btn ghost small', '⬆️ Import JSON');
    var bDemo = el('button', 'btn ghost small', '✨ Load demo data');
    var bClear = el('button', 'btn danger small', '🗑️ Clear all data');
    var fileInput = el('input', null);
    fileInput.type = 'file';
    fileInput.accept = 'application/json,.json';
    fileInput.style.display = 'none';
    toolsRow.appendChild(bExport); toolsRow.appendChild(bImport); toolsRow.appendChild(bDemo); toolsRow.appendChild(bClear);
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
        phrases: getPhrases(), settings: getGoals()
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
          var reading = (data && data.reading) || { materials: [] };
          var writing = (data && data.writing) || { materials: [] };
          var phrases = (data && data.phrases) || [];
          var settings = (data && data.settings) || {};
          if (!window.confirm('Replace current data (' + getRecords().length + ' records, ' + getPhrases().length + ' phrases) with the imported backup?')) return;
          saveRecords(records); saveReading(reading); saveWriting(writing);
          savePhrases(phrases); saveGoals(Object.assign({}, DEFAULT_GOALS, settings));
          Store.set(SEED_KEY, true);
          toast('Backup imported');
          LT.render();
        } catch (err) {
          toast('Import failed — not a valid LifeTrack backup');
        }
      };
      reader.readAsText(file);
      fileInput.value = '';
    });
    bDemo.addEventListener('click', function () { seedDemo(true); toast('Demo data loaded'); LT.render(); });
    bClear.addEventListener('click', function () {
      if (!window.confirm('Delete ALL records, materials, phrases and settings? This cannot be undone.')) return;
      saveRecords([]); saveReading({ materials: [] }); saveWriting({ materials: [] });
      savePhrases([]); Store.set(SEED_KEY, true);
      toast('All data cleared');
      LT.render();
    });
  }

  /* ============================================================
     Demo data
     ============================================================ */
  function seedDemo(force) {
    if (!force && Store.get(SEED_KEY, false)) return false;
    var today = todayISO();
    function rnd(n) { return Math.floor(Math.random() * n); }
    function pick(arr) { return arr[rnd(arr.length)]; }
    var records = [];
    var speakTopics = [
      ['My morning routine', 'Could describe the steps but struggled with "kettle" — learned it!'],
      ['Weekend plans', 'Talked about going to the park and meeting friends.'],
      ['My favorite movie', 'Ran out of words describing the plot — need more storytelling vocab.'],
      ['Food I cooked this week', 'Pasta and vegetables — was able to explain the recipe.'],
      ['My job in one paragraph', 'Said the main ideas but kept pausing for the right words.'],
      ['A book I am reading', 'Explained the characters, mixed up past tenses a few times.'],
      ['Describe my room', 'Simple but smooth — no major issues.'],
      ['Plans after work today', 'Felt natural, used going-to future correctly.'],
      ['My commute', 'Talked about traffic and the train delay.'],
      ['Hobbies and why I like them', 'Good flow, learned the phrase "wind down".']
    ];
    var listenMats = [
      'BBC 6 Minute English — Why we forget',
      'TED talk — The power of vulnerability',
      'News clip — local weather report',
      'Podcast: All Ears English — small talk',
      'English song lyrics shadowing',
      'YouTube — how to make espresso at home'
    ];
    var thinkNotes = [
      'Described my to-do list mentally. Easy.',
      'Thought about lunch in English. Forgot the word "cucumber".',
      'Planned the evening in English while walking.',
      'Inner monologue about the meeting. Felt slow but complete.',
      'Narrated my commute. Smooth today.'
    ];
    var rndRecord = function (daysAgo, act, overrides) {
      var r = Object.assign({
        id: uid(), date: addDays(today, -daysAgo), activity: act,
        createdAt: Date.now() - daysAgo * 86400000 - rnd(6) * 3600000
      }, overrides || {});
      return r;
    };

    /* speaking sessions ~4/week */
    for (var i = 48; i >= 0; i--) {
      if (rnd(7) >= 4) continue;
      var st = pick(speakTopics);
      records.push(rndRecord(i, 'speaking', {
        mode: rnd(10) === 0 ? 'ai' : (rnd(10) === 0 ? 'person' : 'solo'),
        duration: 10 + rnd(6) * 2, topic: st[0], notes: st[1],
        status: 'done', score: 62 + rnd(36)
      }));
    }
    /* think entries */
    for (var j = 50; j >= 0; j--) {
      if (rnd(5) >= 4) continue;
      records.push(rndRecord(j, 'think', { topic: 'Daily thinking', notes: pick(thinkNotes), status: 'done' }));
    }
    /* listen sessions */
    for (var k = 50; k >= 0; k--) {
      if (rnd(7) >= 3) continue;
      records.push(rndRecord(k, 'listen', {
        duration: 12 + rnd(5) * 4, topic: pick(listenMats),
        notes: rnd(3) === 0 ? 'Shadowed the speaker for the last 5 minutes.' : '',
        status: 'done', score: 60 + rnd(38)
      }));
    }
    /* reading material */
    var stories = {
      id: uid(), title: 'English Stories', type: 'story',
      chapters: [
        { id: uid(), title: 'The Lucky Coin', pages: [] },
        { id: uid(), title: 'A Rainy Day', pages: [] },
        { id: uid(), title: 'The Old Bakery', pages: [] }
      ]
    };
    var storyTexts = [
      'Emma found a shiny coin on the pavement. She picked it up and smiled. "My lucky day," she said.',
      'The coin had a strange symbol on one side. Emma turned it over and over, wondering where it came from.',
      'That evening, Emma told her brother Leo about the coin. Leo laughed. "Coins do not bring luck," he said.',
      'The next morning, Emma lost her bus ticket. She searched her pockets and found the coin instead.',
      'Emma decided to walk to school. On the way, she saw a small bakery she had never noticed before.',
      'The bakery smelled of fresh bread. Emma bought a warm roll with the lucky coin.',
      'Inside the roll, Emma found a small note. It said: "Good things come to those who look."',
      'Emma kept the note in her book. Every time she felt unlucky, she read it again.',
      'Years later, Emma became a writer. The note stayed on her desk, a reminder of that rainy morning.',
      'And the coin? Emma gave it to her own daughter, with the same smile she had worn that day.'
    ];
    var chIdx = 0;
    storyTexts.forEach(function (txt, si) {
      if (stories.chapters[chIdx].pages.length >= 4) chIdx++;
      stories.chapters[chIdx].pages.push({
        id: uid(), text: txt,
        status: si < 6 ? 'completed' : (si === 6 ? 'in-progress' : 'not-started'),
        practiced: si < 6 ? 2 + rnd(3) : (si === 6 ? 1 : 0),
        lastDate: si < 6 ? addDays(today, -(rnd(20) + 3)) : (si === 6 ? addDays(today, -1) : null),
        totalMinutes: si < 6 ? 8 + rnd(4) * 2 : (si === 6 ? 6 : 0),
        notes: ''
      });
    });
    var reading = { materials: [stories] };
    /* reading records — walk the flat page list (pages span multiple chapters) */
    var flatPages = [];
    stories.chapters.forEach(function (ch) {
      ch.pages.forEach(function (p) { flatPages.push({ ch: ch, p: p }); });
    });
    for (var m = 0; m < Math.min(8, flatPages.length); m++) {
      var fpg = flatPages[m];
      records.push(rndRecord(40 - m * 5, 'readAloud', {
        duration: 6 + rnd(4), topic: 'English Stories — ' + fpg.ch.title + ' — Page ' + (m + 1),
        status: fpg.p.status === 'completed' ? 'done' : 'partial',
        ref: { type: 'reading-page', id: fpg.p.id }
      }));
    }
    var inProgPage = flatPages.find(function (f) { return f.p.status === 'in-progress'; }) || flatPages[0];
    records.push(rndRecord(1, 'readAloud', {
      duration: 6, topic: 'English Stories — ' + inProgPage.ch.title + ' — Page ' + (flatPages.indexOf(inProgPage) + 1),
      status: 'partial', ref: { type: 'reading-page', id: inProgPage.p.id }
    }));

    /* writing material */
    var routine = {
      id: uid(), title: 'My Daily Routine', type: 'writing',
      pages: [
        { id: uid(), prompt: 'Describe your morning from waking up to leaving home.', original: 'I wake up at 7 o\'clock. I brush my teeth and wash my face. I make coffee and drink it with bread. I check my phone for messages. Then I go to work by train.', date: addDays(today, -12), wordCount: 38, timeSpent: 12, corrections: 'Use "have breakfast" instead of "drink coffee with bread". "By train" → "by the train" is unnecessary; "by train" is correct.', improved: 'I wake up at 7 o\'clock. I brush my teeth and wash my face. I have breakfast — coffee and toast. I check my phone for messages. Then I go to work by train.', notes: 'Short sentences are fine. Work on connectors like "after that".', status: 'completed' },
        { id: uid(), prompt: 'Write about what you do at work in the afternoon.', original: 'At work I answer emails and join meetings. After lunch I write a report. Sometimes I talk with my team about the project. I finish at 6 o\'clock.', date: addDays(today, -6), wordCount: 33, timeSpent: 15, corrections: '"Talk with my team about" — good! Try "discuss the project with my team".', improved: 'At work I answer emails and join meetings. After lunch I write a report. Sometimes I discuss the project with my team. I finish at 6 o\'clock.', notes: 'Good progress. Watch out for "join meetings" → "attend meetings".', status: 'completed' },
        { id: uid(), prompt: 'Describe your evening routine and how you relax.', original: 'In the evening I cook dinner. After dinner I watch a series or read a book. I study English for thirty minutes. I go to bed at 11.', date: addDays(today, -1), wordCount: 27, timeSpent: 9, corrections: '', improved: '', notes: 'Need to expand — describe what you cook and what you watch.', status: 'in-progress' }
      ]
    };
    var writing = { materials: [routine] };
    records.push(rndRecord(12, 'writing', { duration: 12, topic: 'My Daily Routine — Page 1', status: 'done', ref: { type: 'writing-page', id: routine.pages[0].id } }));
    records.push(rndRecord(6, 'writing', { duration: 15, topic: 'My Daily Routine — Page 2', status: 'done', ref: { type: 'writing-page', id: routine.pages[1].id } }));
    records.push(rndRecord(1, 'writing', { duration: 9, topic: 'My Daily Routine — Page 3', status: 'in-progress', ref: { type: 'writing-page', id: routine.pages[2].id } }));

    /* phrases */
    var phraseSeed = [
      ['How is it going?', 'A friendly way to ask how someone is.', 'Hey! How is it going?'],
      ['I am running late.', 'You will arrive after the agreed time.', 'Sorry, I am running late — the train was delayed.'],
      ['Sounds good to me.', 'You agree with a suggestion.', 'Dinner at 7? Sounds good to me.'],
      ['Let me get back to you.', 'You will answer later.', 'I need to check my calendar — let me get back to you.'],
      ['That makes sense.', 'Something is logical or clear.', 'Ah, now that makes sense.'],
      ['I am looking forward to it.', 'You are excited about something in the future.', 'I am looking forward to the trip!'],
      ['Could you say that again?', 'Polite way to ask for repetition.', 'Sorry, could you say that again?'],
      ['It depends.', 'The answer changes based on the situation.', 'Do you like tea or coffee? It depends.'],
      ['No worries.', 'It is not a problem.', 'You forgot the meeting? No worries.'],
      ['I will keep that in mind.', 'You will remember that advice.', 'Good tip — I will keep that in mind.'],
      ['Long time no see.', 'You meet someone after a long time.', 'Hey Alex! Long time no see.'],
      ['Take your time.', 'There is no rush.', 'Read the email slowly — take your time.'],
      ['That is a good point.', 'You agree with an argument.', 'That is a good point, I had not thought of that.'],
      ['I am on my way.', 'You are traveling to the place now.', 'Wait for me, I am on my way.'],
      ['By the way...', 'You add a side note to the conversation.', 'By the way, did you see the news?'],
      ['What do you mean?', 'Ask for clarification.', 'What do you mean by "flexible schedule"?'],
      ['It is up to you.', 'The other person decides.', 'Where should we eat? It is up to you.'],
      ['I will do my best.', 'You will try hard.', 'This is a hard task, but I will do my best.'],
      ['Never mind.', 'It is not important anymore.', 'I forgot what I wanted to say — never mind.'],
      ['Keep in touch.', 'Stay in contact.', 'It was great seeing you — keep in touch!'],
      ['I am not sure yet.', 'You have not decided.', 'Will you join us? I am not sure yet.'],
      ['That explains it.', 'Now you understand the reason.', 'The bus was late — that explains it.'],
      ['What a coincidence!', 'Two things happened by chance.', 'You are also from Mumbai? What a coincidence!'],
      ['I could not agree more.', 'You strongly agree.', 'The ending was perfect — I could not agree more.'],
      ['Have a great day!', 'A kind goodbye wish.', 'Thanks for your help — have a great day!']
    ];
    var phrases = [];
    phraseSeed.forEach(function (p, pi) {
      var learned = addDays(today, -Math.floor((phraseSeed.length - pi) * 1.4) - rnd(2));
      phrases.push({
        id: uid(), phrase: p[0], meaning: p[1], example: p[2],
        notes: '', learned: learned, lastReview: rnd(3) === 0 ? learned : null,
        reviews: rnd(3), status: rnd(3) === 0 ? 'learned' : 'learning'
      });
    });
    /* make sure today has at least 3 phrases (goal visible) */
    phrases.slice(0, 3).forEach(function (p) { p.learned = today; });

    saveRecords(records);
    saveReading(reading);
    saveWriting(writing);
    savePhrases(phrases);
    saveGoals(DEFAULT_GOALS);
    Store.set(SEED_KEY, true);
    return true;
  }

  /* ---------------- Public data layer (for other module files + AI features) ---------------- */
  window.LTEnglish = {
    ACTIVITIES: ACTIVITIES, ACTIVITY_IDS: ACTIVITY_IDS, SPEAK_MODES: SPEAK_MODES,
    DEFAULT_GOALS: DEFAULT_GOALS,
    REC_KEY: REC_KEY, READ_KEY: READ_KEY, WRITE_KEY: WRITE_KEY,
    PHRASE_KEY: PHRASE_KEY, SET_KEY: SET_KEY, SEED_KEY: SEED_KEY,
    act: act,
    getRecords: getRecords, saveRecords: saveRecords,
    addRecord: addRecord, updateRecord: updateRecord, deleteRecord: deleteRecord,
    upsertRefRecord: upsertRefRecord, sortByDateDesc: sortByDateDesc,
    getReading: getReading, saveReading: saveReading,
    getWriting: getWriting, saveWriting: saveWriting,
    getPhrases: getPhrases, savePhrases: savePhrases,
    getGoals: getGoals, saveGoals: saveGoals,
    wordCount: wordCount, pageLabel: pageLabel,
    readingTotals: readingTotals, writingTotals: writingTotals,
    computeStats: computeStats, computeStreak: computeStreak,
    bucketize: bucketize, dayMap: dayMap, phrasesByDay: phrasesByDay,
    seedDemo: seedDemo,
    ui: { card: card, emptyState: emptyState, statusChip: statusChip, scoreChip: scoreChip, goalRow: goalRow, recordRow: recordRow, buildHeatmap: buildHeatmap, legendHTML: legendHTML }
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
