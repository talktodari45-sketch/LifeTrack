/* ============================================================
   LifeTrack — English Learning · Read Aloud
   Book/Material → Chapter → Page management with practice log
   ============================================================ */
(function () {
  'use strict';

  var LT = window.LifeTrack;
  var E = window.LTEnglish;
  var H = LT.helpers;
  var esc = H.esc, uid = H.uid, todayISO = H.todayISO;
  var fmtDate = H.fmtDate, fmtMinutes = H.fmtMinutes;
  var el = H.el, toast = H.toast;

  var openMatId = null;
  var practicePageId = null;
  var openChapterId = null;

  var TYPES = { book: 'Book', story: 'Story', article: 'Article' };

  function findPage(reading, matId, pageId) {
    for (var mi = 0; mi < reading.materials.length; mi++) {
      var m = reading.materials[mi];
      if (m.id !== matId) continue;
      for (var ci = 0; ci < (m.chapters || []).length; ci++) {
        var ch = m.chapters[ci];
        for (var pi = 0; pi < (ch.pages || []).length; pi++) {
          if (ch.pages[pi].id === pageId) return { material: m, chapter: ch, page: ch.pages[pi], pi: pi, ci: ci, mi: mi };
        }
      }
    }
    return null;
  }

  function readView(view) {
    var q = {};
    var hq = location.hash.split('?')[1];
    if (hq) hq.split('&').forEach(function (kv) { var p = kv.split('='); if (p.length === 2) q[p[0]] = decodeURIComponent(p[1]); });
    openMatId = q.mat || null;
    practicePageId = q.page || null;

    var reading = E.getReading();
    var wrap = el('div', 'view-body');
    var head = el('div', 'page-head');
    head.innerHTML = '<h1>Read Aloud 📖</h1><p>Books and stories → chapters → pages. Read each page aloud, log your time, and watch the pages fill up.</p>';
    wrap.appendChild(head);

    if (practicePageId) {
      renderPractice(wrap, reading);
    } else if (openMatId) {
      renderMaterial(wrap, reading);
    } else {
      renderList(wrap, reading);
    }
    view.appendChild(wrap);
  }

  /* ---------- List ---------- */
  function renderList(wrap, reading) {
    var list = el('div', 'mat-list');
    if (!(reading.materials || []).length) {
      list.appendChild(el('p', 'cell-muted', 'No materials yet — create your first book or story below.'));
    }
    (reading.materials || []).forEach(function (m) {
      var t = 0, d = 0, ip = 0, prac = 0;
      (m.chapters || []).forEach(function (ch) {
        (ch.pages || []).forEach(function (p) {
          t++;
          if (p.status === 'completed') d++;
          else if (p.status === 'in-progress') ip++;
          prac += p.practiced || 0;
        });
      });
      var pct = t ? Math.round(d / t * 100) : 0;
      var card = el('div', 'mat-card');
      card.innerHTML =
        '<div class="mat-emoji">📖</div>' +
        '<div class="mat-main"><div class="mat-title">' + esc(m.title) + '</div>' +
        '<div class="mat-meta">' + (TYPES[m.type] || 'Material') + ' · <b>' + d + ' / ' + t + ' pages completed</b>' + (ip ? ' · ' + ip + ' in progress' : '') + ' · ' + prac + ' practices</div>' +
        '<div class="mat-track"><div class="goal-fill" style="width:' + pct + '%"></div></div></div>' +
        '<div class="mat-actions">' +
        '<button class="btn primary small btn-open">Open</button>' +
        '<button class="btn danger small btn-del">Delete</button></div>';
      card.querySelector('.btn-open').addEventListener('click', function () { location.hash = '#/english/read?mat=' + m.id; });
      card.querySelector('.btn-del').addEventListener('click', function () {
        if (!window.confirm('Delete "' + m.title + '" and all its pages?')) return;
        var d2 = E.getReading();
        d2.materials = d2.materials.filter(function (x) { return x.id !== m.id; });
        E.saveReading(d2);
        toast('Material deleted');
        LT.render();
      });
      list.appendChild(card);
    });
    wrap.appendChild(list);

    /* add material */
    var form = el('form', 'card form-card');
    form.innerHTML =
      '<h2>New material</h2><div class="card-sub">Create a book, story or article — then add chapters and pages.</div>' +
      '<div class="form-grid">' +
      '  <label class="span2">Title<input name="title" type="text" required placeholder="e.g. English Stories, My News Article"></label>' +
      '  <label>Type<select name="type"><option value="story">Story</option><option value="book">Book</option><option value="article">Article</option></select></label>' +
      '</div>' +
      '<div class="form-actions"><button class="btn primary" type="submit">➕ Create material</button></div>';
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var title = form.title.value.trim();
      if (!title) { toast('Title is required'); return; }
      var d = E.getReading();
      d.materials.push({ id: uid(), title: title, type: form.type.value, chapters: [] });
      E.saveReading(d);
      toast('Material created');
      LT.render();
    });
    wrap.appendChild(form);
  }

  /* ---------- Material detail ---------- */
  function renderMaterial(wrap, reading) {
    var m = null;
    (reading.materials || []).forEach(function (x) { if (x.id === openMatId) m = x; });
    if (!m) { openMatId = null; renderList(wrap, reading); return; }

    var t = 0, d = 0, ip = 0;
    (m.chapters || []).forEach(function (ch) {
      (ch.pages || []).forEach(function (p) { t++; if (p.status === 'completed') d++; else if (p.status === 'in-progress') ip++; });
    });
    var back = el('a', 'btn ghost small', '← All materials');
    back.href = '#/english/read';
    var row = el('div', 'head-row');
    row.appendChild(back);
    var pct = t ? Math.round(d / t * 100) : 0;
    var summary = el('div', 'card');
    summary.innerHTML = '<h2>' + esc(m.title) + '</h2>' +
      '<div class="card-sub">' + (TYPES[m.type] || 'Material') + ' · ' + d + ' / ' + t + ' pages completed' + (ip ? ' · ' + ip + ' in progress' : '') + '</div>' +
      '<div class="mat-track" style="max-width:420px"><div class="goal-fill" style="width:' + pct + '%"></div></div>';
    wrap.appendChild(row);
    wrap.appendChild(summary);

    /* add chapter */
    var chForm = el('form', 'card form-card');
    chForm.innerHTML = '<h2>Add chapter</h2><div class="form-grid">' +
      '<label>Chapter title<input name="title" type="text" required placeholder="e.g. The Lucky Coin"></label>' +
      '<label>Pages to create<input name="pages" type="number" min="1" max="50" value="1"></label></div>' +
      '<div class="form-actions"><button class="btn primary" type="submit">➕ Add chapter</button></div>';
    chForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var title = chForm.title.value.trim() || 'Chapter ' + ((m.chapters || []).length + 1);
      var n = Math.max(1, Math.min(50, parseInt(chForm.pages.value, 10) || 1));
      var ch = { id: uid(), title: title, pages: [] };
      for (var i = 0; i < n; i++) {
        ch.pages.push({ id: uid(), text: '', status: 'not-started', practiced: 0, lastDate: null, totalMinutes: 0, notes: '' });
      }
      var d = E.getReading();
      d.materials.forEach(function (x) { if (x.id === m.id) x.chapters.push(ch); });
      E.saveReading(d);
      toast('Chapter added with ' + n + ' page' + (n === 1 ? '' : 's'));
      LT.render();
    });
    wrap.appendChild(chForm);

    /* chapters */
    (m.chapters || []).forEach(function (ch, ci) {
      var block = el('div', 'chapter-block' + (openChapterId === ch.id ? ' open' : ''));
      var done = ch.pages.filter(function (p) { return p.status === 'completed'; }).length;
      var head = el('div', 'chapter-head');
      head.innerHTML = '<span class="chev">▶</span><span>' + esc(ch.title) + '</span><span class="ch-meta">' + done + ' / ' + ch.pages.length + ' pages</span>';
      head.addEventListener('click', function () {
        openChapterId = openChapterId === ch.id ? null : ch.id;
        LT.render();
      });
      block.appendChild(head);
      var body = el('div', 'chapter-body');
      ch.pages.forEach(function (p, pi) {
        var prow = el('div', 'page-row');
        var last = p.lastDate ? fmtDate(p.lastDate) : 'never';
        prow.innerHTML =
          '<div class="p-num">' + (pi + 1) + '</div>' +
          '<div class="p-main"><div class="p-title">' + (p.text ? esc(p.text.slice(0, 60)) + (p.text.length > 60 ? '…' : '') : 'Empty page') + '</div>' +
          '<div class="p-meta">practiced ' + (p.practiced || 0) + '× · ' + (p.totalMinutes || 0) + ' min · last ' + last + '</div></div>' +
          '<div class="p-side">' + E.ui.statusChip(p.status).outerHTML + '</div>' +
          '<div class="row-actions"><button class="btn ghost small btn-practice">Practice</button></div>';
        prow.querySelector('.btn-practice').addEventListener('click', function () {
          location.hash = '#/english/read?mat=' + m.id + '&page=' + p.id;
        });
        body.appendChild(prow);
      });
      var addPageBtn = el('button', 'btn ghost small', '+ Add page');
      addPageBtn.style.margin = '8px 10px 4px';
      addPageBtn.addEventListener('click', function () {
        var d = E.getReading();
        d.materials.forEach(function (x) {
          if (x.id !== m.id) return;
          (x.chapters || []).forEach(function (c) {
            if (c.id === ch.id) c.pages.push({ id: uid(), text: '', status: 'not-started', practiced: 0, lastDate: null, totalMinutes: 0, notes: '' });
          });
        });
        E.saveReading(d);
        toast('Page added');
        LT.render();
      });
      body.appendChild(addPageBtn);
      block.appendChild(body);
      wrap.appendChild(block);
    });
    if (!(m.chapters || []).length) {
      wrap.appendChild(el('p', 'cell-muted', 'No chapters yet — add one above.'));
    }
  }

  /* ---------- Page practice ---------- */
  function renderPractice(wrap, reading) {
    var found = null;
    (reading.materials || []).forEach(function (m) {
      if (found) return;
      (m.chapters || []).forEach(function (ch) {
        if (found) return;
        (ch.pages || []).forEach(function (p, pi) {
          if (p.id === practicePageId) found = { material: m, chapter: ch, page: p, pi: pi };
        });
      });
    });
    if (!found) { practicePageId = null; renderMaterial(wrap, reading); return; }

    var m = found.material, ch = found.chapter, p = found.page;
    var back = el('a', 'btn ghost small', '← Back to ' + esc(m.title));
    back.href = '#/english/read?mat=' + m.id;
    wrap.appendChild(el('div', 'head-row', null)).appendChild(back);

    var titleCard = el('div', 'card');
    titleCard.innerHTML = '<h2>' + esc(m.title + ' — ' + ch.title) + '</h2>' +
      '<div class="card-sub">Practiced ' + (p.practiced || 0) + '× · ' + (p.totalMinutes || 0) + ' min total · last ' + (p.lastDate ? fmtDate(p.lastDate) : 'never') + ' · status: ' + esc(p.status.replace('-', ' ')) + '</div>';
    wrap.appendChild(titleCard);

    if (p.text) {
      var paperCard = el('div', 'card');
      paperCard.appendChild(el('div', 'card-sub', 'Read this page aloud. Pause, repeat tricky sentences.'));
      paperCard.appendChild(el('div', 'paper', esc(p.text)));
      wrap.appendChild(paperCard);
    } else {
      var emptyCard = el('div', 'card');
      emptyCard.appendChild(el('p', 'cell-muted', 'This page has no text yet — add it in the page editor below.'));
      wrap.appendChild(emptyCard);
    }

    var form = el('form', 'card form-card');
    form.innerHTML = '<h2>Log a practice session</h2>' +
      '<div class="form-grid">' +
      '  <label>Date<input name="date" type="date" required></label>' +
      '  <label>Duration (minutes)<input name="duration" type="number" min="1" max="300" required placeholder="10"></label>' +
      '  <label class="span2">Notes<textarea name="notes" rows="2" placeholder="Difficult words? Pronunciation wins?"></textarea></label>' +
      '  <label>Status after this session<select name="status"><option value="in-progress">In progress</option><option value="completed">Completed ✅</option></select></label>' +
      '</div>' +
      '<div class="form-actions"><button class="btn primary" type="submit">🎤 Log practice</button>' +
      '<button class="btn ghost" type="button" id="btn-skip">Back without logging</button></div>';
    form.date.value = todayISO();
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var dur = parseInt(form.duration.value, 10);
      if (!form.date.value || !dur || dur < 1) { toast('Date and duration are required'); return; }
      var d = E.getReading();
      var target = null;
      d.materials.forEach(function (mx) {
        (mx.chapters || []).forEach(function (cx) {
          (cx.pages || []).forEach(function (px) { if (px.id === practicePageId) target = px; });
        });
      });
      if (!target) { toast('Page not found'); return; }
      var newStatus = form.status.value;
      target.practiced = (target.practiced || 0) + 1;
      target.lastDate = form.date.value;
      target.totalMinutes = (target.totalMinutes || 0) + dur;
      if (target.status !== 'completed') target.status = newStatus === 'completed' ? 'completed' : 'in-progress';
      target.notes = form.notes.value.trim() || target.notes;
      E.saveReading(d);
      E.addRecord({
        date: form.date.value, activity: 'readAloud',
        duration: dur, topic: E.pageLabel(m, ch, p, found.pi),
        notes: form.notes.value.trim(), status: newStatus,
        ref: { type: 'reading-page', id: p.id }, createdAt: Date.now()
      });
      toast(target.status === 'completed' ? 'Page completed — great job! 🎉' : 'Practice logged');
      LT.render();
    });
    form.querySelector('#btn-skip').addEventListener('click', function () { location.hash = '#/english/read?mat=' + m.id; });
    wrap.appendChild(form);

    /* page editor */
    var editCard = el('div', 'card');
    editCard.appendChild(el('h2', null, 'Edit page'));
    editCard.appendChild(el('div', 'card-sub', 'Set the reading text and page status directly.'));
    var eform = el('div', 'form-grid');
    eform.innerHTML = '<label class="span2">Reading text<textarea name="text" rows="6" placeholder="Paste the text of this page…"></textarea></label>' +
      '<label>Status<select name="status"><option value="not-started">Not started</option><option value="in-progress">In progress</option><option value="completed">Completed</option></select></label>' +
      '<label>Notes<textarea name="notes" rows="2" placeholder="Page-level notes"></textarea></label>';
    eform.querySelector('[name=text]').value = p.text || '';
    eform.querySelector('[name=status]').value = p.status;
    eform.querySelector('[name=notes]').value = p.notes || '';
    var saveEdit = el('button', 'btn ghost small', '💾 Save page');
    saveEdit.addEventListener('click', function () {
      var d = E.getReading();
      var target = null;
      d.materials.forEach(function (mx) {
        (mx.chapters || []).forEach(function (cx) {
          (cx.pages || []).forEach(function (px) { if (px.id === practicePageId) target = px; });
        });
      });
      if (!target) { toast('Page not found'); return; }
      target.text = eform.querySelector('[name=text]').value;
      target.status = eform.querySelector('[name=status]').value;
      target.notes = eform.querySelector('[name=notes]').value.trim();
      E.saveReading(d);
      toast('Page saved');
      LT.render();
    });
    editCard.appendChild(eform);
    editCard.appendChild(el('div', 'form-actions', null)).appendChild(saveEdit);
    wrap.appendChild(editCard);
  }

  LT.extendModule('english', {
    tabs: [],
    views: { read: readView }
  });
})();
