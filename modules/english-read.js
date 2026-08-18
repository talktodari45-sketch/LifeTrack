/* ============================================================
   LifeTrack — English Learning · Read Aloud (flat, no inside page)
   Everything on one view: materials, chapters, pages, media.
   ============================================================ */
(function () {
  'use strict';

  var LT = window.LifeTrack;
  var E = window.LTEnglish;
  var H = LT.helpers;
  var C = LT.charts;
  var esc = H.esc, uid = H.uid, todayISO = H.todayISO;
  var el = H.el, toast = H.toast;

  var TYPES = { book: 'Book', story: 'Story', article: 'Article' };
  var editChKey = null; /* 'matId::chId' while editing a chapter */

  function pageCount(ch) {
    if (typeof ch.pages === 'number') return Math.max(1, ch.pages);
    return Math.max(1, (ch.pages || []).length || 1);
  }

  function readView(view) {
    var reading = E.getReading();
    var dur = E.getDurations();
    var wrap = el('div', 'view-body');
    var head = el('div', 'page-head');
    head.innerHTML = '<h1>Read Aloud 📖</h1><p class="head-dur">⏱️ ' + dur.read + ' min</p><p>Books, stories, chapters, pages and recordings — all on one page, no opening anything.</p>';
    wrap.appendChild(head);

    /* read aloud dashboard KPIs + progress chart */
    var rTot = E.readingTotals(reading);
    var readRecs = E.getRecords().filter(function (r) { return r.activity === 'readAloud'; });
    var readWeek = readRecs.filter(function (r) { return r.date >= H.addDays(todayISO(), -6); }).reduce(function (a, r) { return a + (r.pages || 0); }, 0);
    wrap.appendChild(E.ui.statGrid([
      { icon: '📚', label: 'Materials', value: String((reading.materials || []).length), sub: 'books, stories & articles', color: '#f59e0b' },
      { icon: '📖', label: 'Chapters', value: String(rTot.chapters), sub: 'across all materials', color: '#f59e0b' },
      { icon: '📄', label: 'Total pages', value: String(rTot.total), sub: 'all chapters', color: '#f59e0b' },
      { icon: '📅', label: 'Pages this week', value: String(readWeek), sub: 'last 7 days', color: '#6366f1' }
    ]));
    var readChart = E.ui.card('Reading progress', 'Pages read per day — last 14 days');
    var readCanvas = el('canvas', 'chart');
    readChart.appendChild(readCanvas);
    wrap.appendChild(readChart);

    /* new material */
    var form = el('form', 'card form-card');
    form.innerHTML =
      '<h2>New material</h2><div class="card-sub">Create a book, story or article — chapters go right inside it below.</div>' +
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

    /* materials with inline chapters */
    var list = el('div', 'mat-list');
    if (!(reading.materials || []).length) {
      list.appendChild(el('p', 'cell-muted', 'No materials yet — create your first book or story above.'));
    }
    (reading.materials || []).forEach(function (m) {
      list.appendChild(renderMaterialCard(m));
    });
    wrap.appendChild(list);
    view.appendChild(wrap);

    var readSeries = E.seriesBuckets(readRecs, 'day', function (r) { return r.pages || 0; });
    C.barChart(readCanvas, { labels: readSeries.labels, values: readSeries.values, color: '#f59e0b', format: function (v) { return String(Math.round(v)); } });
  }

  function renderMaterialCard(m) {
    var chs = m.chapters || [];
    var pages = 0;
    chs.forEach(function (ch) { pages += pageCount(ch); });
    var editing = null, editingMat = false;
    if (editChKey && editChKey.indexOf(m.id + '::') === 0) {
      editingMat = true;
      var cid = editChKey.slice(m.id.length + 2);
      chs.forEach(function (ch) { if (ch.id === cid) editing = ch; });
    }

    var card = el('div', 'card');
    var head = el('div', 'read-mat-head');
    head.innerHTML = '<span class="read-mat-title">📖 ' + esc(m.title) + '</span>';
    var delMat = el('button', 'btn danger small', 'Delete');
    delMat.addEventListener('click', function () {
      if (!window.confirm('Delete "' + m.title + '" and all its chapters?')) return;
      var chIds = (m.chapters || []).map(function (c) { return c.id; });
      var d = E.getReading();
      d.materials = d.materials.filter(function (x) { return x.id !== m.id; });
      E.saveReading(d);
      E.getRecords().filter(function (r) { return r.ref && r.ref.type === 'reading-chapter' && chIds.indexOf(r.ref.id) !== -1; })
        .forEach(function (r) { E.deleteRecord(r.id); });
      if (editChKey && editChKey.indexOf(m.id + '::') === 0) editChKey = null;
      toast('Material deleted');
      LT.render();
    });
    head.appendChild(delMat);
    card.appendChild(head);
    card.appendChild(el('div', 'read-mat-meta', (TYPES[m.type] || 'Material') + ' · ' + chs.length + ' chapter' + (chs.length === 1 ? '' : 's') + ' · ' + pages + ' page' + (pages === 1 ? '' : 's')));

    /* chapters */
    chs.forEach(function (ch) {
      var block = el('div', 'chapter-block');
      var chHead = el('div', 'chapter-head');
      chHead.innerHTML = '<span class="chev">▶</span><span>' + esc(ch.title) + '</span><span class="ch-meta">' + pageCount(ch) + ' pages</span>';
      block.appendChild(chHead);
      var body = el('div', 'chapter-body');
      var row = el('div', 'page-row');
      var main = el('div', 'p-main');
      main.appendChild(el('div', 'p-meta', pageCount(ch) + ' pages' + ((ch.photos && ch.photos.length) ? ' · 🖼' : '') + ((ch.audios && ch.audios.length) ? ' · 🎤' : '')));
      var bar = E.media.rowMediaBar({
        photos: ch.photos || [],
        audios: ch.audios || [],
        allowAudio: true,
        onChange: function (patch) {
          var d = E.getReading();
          d.materials.forEach(function (x) {
            if (x.id !== m.id) return;
            (x.chapters || []).forEach(function (c) { if (c.id === ch.id) { c.photos = patch.photos; c.audios = patch.audios; } });
          });
          E.saveReading(d);
          toast('Attachment saved');
        }
      });
      main.appendChild(bar);
      row.appendChild(main);
      var actions = el('div', 'row-actions');
      var btnEdit = el('button', 'btn ghost small', 'Edit');
      btnEdit.addEventListener('click', function () { editChKey = m.id + '::' + ch.id; LT.render(); });
      var btnDel = el('button', 'btn danger small', 'Delete chapter');
      btnDel.addEventListener('click', function () {
        if (!window.confirm('Delete this chapter?')) return;
        var d = E.getReading();
        d.materials.forEach(function (x) {
          if (x.id !== m.id) return;
          x.chapters = (x.chapters || []).filter(function (c) { return c.id !== ch.id; });
        });
        E.saveReading(d);
        E.getRecords().filter(function (r) { return r.ref && r.ref.type === 'reading-chapter' && r.ref.id === ch.id; })
          .forEach(function (r) { E.deleteRecord(r.id); });
        if (editChKey === m.id + '::' + ch.id) editChKey = null;
        toast('Chapter deleted');
        LT.render();
      });
      actions.appendChild(btnEdit);
      actions.appendChild(btnDel);
      row.appendChild(actions);
      body.appendChild(row);
      block.appendChild(body);
      card.appendChild(block);
    });
    if (!chs.length) {
      card.appendChild(el('p', 'cell-muted', 'No chapters yet — add one below.'));
    }

    /* inline add / edit chapter */
    var chForm = el('form', 'ch-form');
    chForm.innerHTML = '<div class="form-grid">' +
      '  <label>' + (editingMat ? 'Chapter title' : 'Add chapter') + '<input name="title" type="text" required placeholder="e.g. The Lucky Coin"></label>' +
      '  <label>Pages<input name="pages" type="number" min="1" max="500" value="1"></label>' +
      '</div>' +
      '<div class="form-actions">' +
      '<button class="btn primary" type="submit">' + (editingMat ? '💾 Save chapter' : '➕ Add chapter') + '</button>' +
      (editingMat ? '<button class="btn ghost" type="button" id="btn-cancel">Cancel</button>' : '') +
      '</div>';
    var chPhoto = E.media.mediaAttach(editing ? editing.photos : null, { accept: 'image/*', label: 'Photo (optional)', kind: 'photo', multiple: true });
    var chAudio = E.media.mediaAttach(editing ? editing.audios : null, { accept: 'audio/*', label: 'Audio recording (optional)', kind: 'audio', multiple: true });
    chForm.appendChild(chPhoto.el);
    chForm.appendChild(chAudio.el);
    card.appendChild(chForm);

    var cf = chForm;
    cf.title.value = editing ? editing.title : '';
    cf.pages.value = editing ? pageCount(editing) : 1;
    var cancelBtn = cf.querySelector('#btn-cancel');
    if (cancelBtn) cancelBtn.addEventListener('click', function () { editChKey = null; LT.render(); });
    cf.addEventListener('submit', function (e) {
      e.preventDefault();
      var title = cf.title.value.trim() || 'Chapter ' + (chs.length + 1);
      var n = Math.max(1, parseInt(cf.pages.value, 10) || 1);
      Promise.all([chPhoto.resolve(), chAudio.resolve()]).then(function (res) {
        var d = E.getReading();
        var target = null;
        d.materials.forEach(function (x) { if (x.id === m.id) target = x; });
        if (!target) { toast('Material not found'); return; }
        var ch = { id: editing ? editing.id : uid(), title: title, pages: n, photos: res[0], audios: res[1] };
        if (editing) {
          target.chapters = (target.chapters || []).map(function (c) { return c.id === ch.id ? ch : c; });
          toast('Chapter updated');
        } else {
          target.chapters = (target.chapters || []).concat([ch]);
          toast('Chapter saved');
        }
        E.saveReading(d);
        E.upsertRefRecord('reading-chapter', ch.id, {
          date: todayISO(), activity: 'readAloud',
          duration: 0, topic: m.title + ' — ' + ch.title,
          notes: n + (n === 1 ? ' page' : ' pages'),
          pages: n,
          status: 'done', score: null, createdAt: Date.now()
        });
        if (!editing) E.onTaskComplete('readAloud');
        editChKey = null;
        LT.render();
      });
    });

    return card;
  }

  LT.extendModule('english', {
    tabs: [],
    views: { read: readView }
  });
})();
