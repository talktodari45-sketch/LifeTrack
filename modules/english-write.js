/* ============================================================
   LifeTrack — English Learning · Writing
   Writing Material → Pages (prompt, original, corrections,
   improved version) — pick up exactly where you stopped.
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
  var editPageId = null;

  function findPage(writing, matId, pageId) {
    for (var mi = 0; mi < writing.materials.length; mi++) {
      var m = writing.materials[mi];
      if (m.id !== matId) continue;
      for (var pi = 0; pi < (m.pages || []).length; pi++) {
        if (m.pages[pi].id === pageId) return { material: m, page: m.pages[pi], pi: pi };
      }
    }
    return null;
  }

  function writeView(view) {
    var q = {};
    var hq = location.hash.split('?')[1];
    if (hq) hq.split('&').forEach(function (kv) { var p = kv.split('='); if (p.length === 2) q[p[0]] = decodeURIComponent(p[1]); });
    openMatId = q.mat || null;
    editPageId = q.page || null;

    var writing = E.getWriting();
    var wrap = el('div', 'view-body');
    var head = el('div', 'page-head');
    head.innerHTML = '<h1>Writing ✍️</h1><p>Writing material → pages. Keep your original text, your corrections and the improved version side by side.</p>';
    wrap.appendChild(head);

    if (editPageId) {
      renderEditor(wrap, writing);
    } else if (openMatId) {
      renderMaterial(wrap, writing);
    } else {
      renderList(wrap, writing);
    }
    view.appendChild(wrap);
  }

  /* ---------- List ---------- */
  function renderList(wrap, writing) {
    var list = el('div', 'mat-list');
    if (!(writing.materials || []).length) {
      list.appendChild(el('p', 'cell-muted', 'No writing materials yet — create one below.'));
    }
    (writing.materials || []).forEach(function (m) {
      var t = 0, d = 0, ip = 0, words = 0;
      var lastActive = null, lastActivePi = -1;
      (m.pages || []).forEach(function (p, pi) {
        t++;
        if (p.status === 'completed') d++;
        else if (p.status === 'in-progress') { ip++; if (pi > lastActivePi) { lastActivePi = pi; lastActive = p; } }
        words += p.wordCount || 0;
      });
      var pct = t ? Math.round(d / t * 100) : 0;
      var card = el('div', 'mat-card');
      card.innerHTML =
        '<div class="mat-emoji">✍️</div>' +
        '<div class="mat-main"><div class="mat-title">' + esc(m.title) + '</div>' +
        '<div class="mat-meta">' + d + ' / ' + t + ' pages done' + (ip ? ' · ' + ip + ' in progress' : '') + ' · ' + words + ' words written</div>' +
        '<div class="mat-track"><div class="goal-fill" style="width:' + pct + '%"></div></div></div>' +
        '<div class="mat-actions">' +
        (lastActive ? '<button class="btn primary small btn-continue">Continue writing</button>' : '') +
        '<button class="btn ghost small btn-open">Open</button>' +
        '<button class="btn danger small btn-del">Delete</button></div>';
      if (lastActive) {
        card.querySelector('.btn-continue').addEventListener('click', function () {
          location.hash = '#/english/write?mat=' + m.id + '&page=' + lastActive.id;
        });
      }
      card.querySelector('.btn-open').addEventListener('click', function () { location.hash = '#/english/write?mat=' + m.id; });
      card.querySelector('.btn-del').addEventListener('click', function () {
        if (!window.confirm('Delete "' + m.title + '" and all its pages?')) return;
        var d2 = E.getWriting();
        d2.materials = d2.materials.filter(function (x) { return x.id !== m.id; });
        E.saveWriting(d2);
        toast('Material deleted');
        LT.render();
      });
      list.appendChild(card);
    });
    wrap.appendChild(list);

    var form = el('form', 'card form-card');
    form.innerHTML =
      '<h2>New writing material</h2><div class="card-sub">A material is a collection of pages. Example: \u201cMy Daily Routine\u201d → Page 1 My Morning, Page 2 My Afternoon…</div>' +
      '<div class="form-grid"><label class="span2">Title<input name="title" type="text" required placeholder="e.g. My Daily Routine, Travel Journal"></label></div>' +
      '<div class="form-actions"><button class="btn primary" type="submit">➕ Create material</button></div>';
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var title = form.title.value.trim();
      if (!title) { toast('Title is required'); return; }
      var d = E.getWriting();
      d.materials.push({ id: uid(), title: title, pages: [] });
      E.saveWriting(d);
      toast('Material created');
      LT.render();
    });
    wrap.appendChild(form);
  }

  /* ---------- Material detail ---------- */
  function renderMaterial(wrap, writing) {
    var m = null;
    (writing.materials || []).forEach(function (x) { if (x.id === openMatId) m = x; });
    if (!m) { openMatId = null; renderList(wrap, writing); return; }

    var back = el('a', 'btn ghost small', '← All materials');
    back.href = '#/english/write';
    wrap.appendChild(el('div', 'head-row', null)).appendChild(back);

    var summary = el('div', 'card');
    summary.appendChild(el('h2', null, esc(m.title)));
    summary.appendChild(el('div', 'card-sub', (m.pages || []).length + ' pages · continue from the exact page where you stopped'));
    wrap.appendChild(summary);

    (m.pages || []).forEach(function (p, pi) {
      var prow = el('div', 'page-row');
      var isActive = p.status === 'in-progress';
      prow.innerHTML =
        '<div class="p-num" style="' + (isActive ? 'background:rgba(245,158,11,.18);color:#b45309' : '') + '">' + (pi + 1) + '</div>' +
        '<div class="p-main"><div class="p-title">' + (p.prompt ? esc(p.prompt.length > 60 ? p.prompt.slice(0, 60) + '…' : p.prompt) : 'Untitled page') + '</div>' +
        '<div class="p-meta">' + (p.date ? fmtDate(p.date) : 'not written yet') + ' · ' + (p.wordCount || 0) + ' words · ' + (p.timeSpent ? fmtMinutes(p.timeSpent) : '— time') + '</div></div>' +
        '<div class="p-side">' + E.ui.statusChip(p.status).outerHTML + '</div>' +
        '<div class="row-actions"><button class="btn ' + (isActive ? 'primary' : 'ghost') + ' small btn-edit">' + (isActive ? 'Continue' : 'Open') + '</button></div>';
      prow.querySelector('.btn-edit').addEventListener('click', function () { location.hash = '#/english/write?mat=' + m.id + '&page=' + p.id; });
      wrap.appendChild(prow);
    });
    if (!(m.pages || []).length) wrap.appendChild(el('p', 'cell-muted', 'No pages yet — add the first one below.'));

    var addForm = el('form', 'card form-card');
    addForm.innerHTML = '<h2>Add page</h2><div class="form-grid">' +
      '<label class="span2">Writing prompt / topic<textarea name="prompt" rows="2" required placeholder="e.g. Describe your morning from waking up to leaving home"></textarea></label></div>' +
      '<div class="form-actions"><button class="btn primary" type="submit">➕ Add page</button></div>';
    addForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var prompt = addForm.prompt.value.trim();
      if (!prompt) { toast('Prompt is required'); return; }
      var d = E.getWriting();
      d.materials.forEach(function (x) {
        if (x.id === m.id) x.pages.push({ id: uid(), prompt: prompt, original: '', date: null, wordCount: 0, timeSpent: 0, corrections: '', improved: '', notes: '', status: 'not-started' });
      });
      E.saveWriting(d);
      toast('Page added');
      LT.render();
    });
    wrap.appendChild(addForm);
  }

  /* ---------- Page editor ---------- */
  function renderEditor(wrap, writing) {
    var found = null;
    (writing.materials || []).forEach(function (m) {
      if (found) return;
      (m.pages || []).forEach(function (p, pi) {
        if (p.id === editPageId) found = { material: m, page: p, pi: pi };
      });
    });
    if (!found) { editPageId = null; renderMaterial(wrap, writing); return; }

    var m = found.material, p = found.page, pi = found.pi;
    var back = el('a', 'btn ghost small', '← Back to ' + esc(m.title));
    back.href = '#/english/write?mat=' + m.id;
    wrap.appendChild(el('div', 'head-row', null)).appendChild(back);

    var titleCard = el('div', 'card');
    titleCard.innerHTML = '<h2>' + esc(m.title + ' — Page ' + (pi + 1)) + '</h2>' +
      '<div class="card-sub">' + (p.status === 'in-progress' ? 'You were working on this page — pick up right here.' : '') + '</div>';
    wrap.appendChild(titleCard);

    var form = el('form', 'card form-card');
    form.innerHTML = '<h2>Write</h2>' +
      '<div class="form-grid">' +
      '  <label class="span2">Writing prompt<textarea name="prompt" rows="2" placeholder="The topic you are writing about"></textarea></label>' +
      '  <label class="span2">Your writing<textarea name="original" rows="8" placeholder="Write in English here…"></textarea>' +
      '  <span class="wc-badge" id="wc">0 words</span></label>' +
      '  <label>Date<input name="date" type="date"></label>' +
      '  <label>Time spent (minutes)<input name="timeSpent" type="number" min="0" max="600" placeholder="15"></label>' +
      '  <label class="span2">Mistakes / corrections<textarea name="corrections" rows="3" placeholder="What did you get wrong? Note corrections here."></textarea></label>' +
      '  <label class="span2">Improved version<textarea name="improved" rows="5" placeholder="Rewrite the passage with corrections applied"></textarea></label>' +
      '  <label>Status<select name="status"><option value="not-started">Not started</option><option value="in-progress">In progress</option><option value="completed">Completed</option></select></label>' +
      '  <label>Notes<textarea name="notes" rows="2" placeholder="Ideas for next time"></textarea></label>' +
      '</div>' +
      '<div class="form-actions"><button class="btn primary" type="submit">💾 Save page</button>' +
      '<button class="btn ghost" type="button" id="btn-back">Back without saving</button></div>';
    form.prompt.value = p.prompt || '';
    form.original.value = p.original || '';
    form.date.value = p.date || todayISO();
    form.timeSpent.value = p.timeSpent || '';
    form.corrections.value = p.corrections || '';
    form.improved.value = p.improved || '';
    form.status.value = p.status;
    form.notes.value = p.notes || '';
    function updateWc() {
      var wc = E.wordCount(form.original.value);
      form.querySelector('#wc').textContent = wc + ' word' + (wc === 1 ? '' : 's');
    }
    updateWc();
    form.original.addEventListener('input', updateWc);
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var d = E.getWriting();
      var target = null, tm = null;
      d.materials.forEach(function (mx) {
        (mx.pages || []).forEach(function (px) { if (px.id === editPageId) { target = px; tm = mx; } });
      });
      if (!target) { toast('Page not found'); return; }
      var original = form.original.value;
      var timeSpent = parseInt(form.timeSpent.value, 10) || 0;
      var status = original.trim() ? form.status.value : 'not-started';
      if (original.trim() && status === 'not-started') status = 'in-progress';
      target.prompt = form.prompt.value.trim();
      target.original = original;
      target.date = form.date.value;
      target.timeSpent = timeSpent;
      target.corrections = form.corrections.value.trim();
      target.improved = form.improved.value.trim();
      target.notes = form.notes.value.trim();
      target.wordCount = E.wordCount(original);
      target.status = status;
      E.saveWriting(d);
      /* one record per page — keeps History clean (only when there is real writing) */
      if (original.trim()) {
        E.upsertRefRecord('writing-page', editPageId, {
          date: form.date.value, activity: 'writing',
          duration: timeSpent, topic: tm.title + ' — Page ' + (pi + 1),
          notes: original.trim() ? (form.notes.value.trim() || 'Wrote ' + target.wordCount + ' words') : '',
          status: status === 'completed' ? 'done' : (status === 'in-progress' ? 'partial' : 'done'),
          score: 0, createdAt: Date.now()
        });
      }
      toast('Page saved');
      editPageId = null;
      LT.render();
    });
    form.querySelector('#btn-back').addEventListener('click', function () { location.hash = '#/english/write?mat=' + m.id; });
    wrap.appendChild(form);

    if (p.improved || p.corrections) {
      var revCard = el('div', 'card');
      revCard.appendChild(el('h2', null, 'Saved review'));
      if (p.corrections) {
        revCard.appendChild(el('div', 'card-sub', 'Corrections'));
        revCard.appendChild(el('div', 'paper', esc(p.corrections)));
      }
      if (p.improved) {
        revCard.appendChild(el('div', 'card-sub', 'Improved version'));
        revCard.appendChild(el('div', 'paper', esc(p.improved)));
      }
      wrap.appendChild(revCard);
    }
  }

  LT.extendModule('english', {
    tabs: [],
    views: { write: writeView }
  });
})();
