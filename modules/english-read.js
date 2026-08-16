/* ============================================================
   LifeTrack — English Learning · Read Aloud (simple log)
   Material: title + type. Chapters: title, pages, photo/audio.
   No page editor — keep it simple.
   ============================================================ */
(function () {
  'use strict';

  var LT = window.LifeTrack;
  var E = window.LTEnglish;
  var H = LT.helpers;
  var esc = H.esc, uid = H.uid, todayISO = H.todayISO;
  var el = H.el, toast = H.toast;

  var TYPES = { book: 'Book', story: 'Story', article: 'Article' };
  var openMatId = null;
  var editChId = null;

  function pageCount(ch) {
    if (typeof ch.pages === 'number') return Math.max(1, ch.pages);
    return Math.max(1, (ch.pages || []).length || 1);
  }

  function readView(view) {
    var q = {};
    var hq = location.hash.split('?')[1];
    if (hq) hq.split('&').forEach(function (kv) { var p = kv.split('='); if (p.length === 2) q[p[0]] = decodeURIComponent(p[1]); });
    openMatId = q.mat || null;

    var reading = E.getReading();
    var wrap = el('div', 'view-body');
    var head = el('div', 'page-head');
    head.innerHTML = '<h1>Read Aloud 📖</h1><p>Log the books and stories you read aloud: chapters, pages, and a photo or recording.</p>';
    wrap.appendChild(head);

    if (openMatId) {
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
      var chs = m.chapters || [];
      var pages = 0;
      chs.forEach(function (ch) { pages += pageCount(ch); });
      var card = el('div', 'mat-card');
      card.innerHTML =
        '<div class="mat-emoji">📖</div>' +
        '<div class="mat-main"><div class="mat-title">' + esc(m.title) + '</div>' +
        '<div class="mat-meta">' + (TYPES[m.type] || 'Material') + ' · ' + chs.length + ' chapter' + (chs.length === 1 ? '' : 's') + ' · ' + pages + ' page' + (pages === 1 ? '' : 's') + '</div></div>' +
        '<div class="mat-actions">' +
        '<button class="btn primary small btn-open">Open</button>' +
        '<button class="btn danger small btn-del">Delete</button></div>';
      card.querySelector('.btn-open').addEventListener('click', function () { location.hash = '#/english/read?mat=' + m.id; });
      card.querySelector('.btn-del').addEventListener('click', function () {
        if (!window.confirm('Delete "' + m.title + '" and all its chapters?')) return;
        var d = E.getReading();
        d.materials = d.materials.filter(function (x) { return x.id !== m.id; });
        E.saveReading(d);
        toast('Material deleted');
        LT.render();
      });
      list.appendChild(card);
    });
    wrap.appendChild(list);

    /* add material */
    var form = el('form', 'card form-card');
    form.innerHTML =
      '<h2>New material</h2><div class="card-sub">Create a book, story or article — then add chapters.</div>' +
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

  /* ---------- Material detail: chapters ---------- */
  function renderMaterial(wrap, reading) {
    var m = null;
    (reading.materials || []).forEach(function (x) { if (x.id === openMatId) m = x; });
    if (!m) { openMatId = null; renderList(wrap, reading); return; }

    var chs = m.chapters || [];
    var pages = 0;
    chs.forEach(function (ch) { pages += pageCount(ch); });

    var back = el('a', 'btn ghost small', '← All materials');
    back.href = '#/english/read';
    wrap.appendChild(el('div', 'head-row', null)).appendChild(back);

    var summary = el('div', 'card');
    summary.innerHTML = '<h2>' + esc(m.title) + '</h2>' +
      '<div class="card-sub">' + (TYPES[m.type] || 'Material') + ' · ' + chs.length + ' chapter' + (chs.length === 1 ? '' : 's') + ' · ' + pages + ' page' + (pages === 1 ? '' : 's') + '</div>';
    wrap.appendChild(summary);

    /* add / edit chapter */
    var editing = editChId ? (chs.find(function (x) { return x.id === editChId; }) || null) : null;
    var chForm = el('form', 'card form-card');
    chForm.innerHTML = '<h2 id="cf-title">Add chapter</h2><div class="card-sub">Chapter title, how many pages, plus a photo or recording.</div>' +
      '<div class="form-grid">' +
      '  <label>Chapter title<input name="title" type="text" required placeholder="e.g. The Lucky Coin"></label>' +
      '  <label>Pages<input name="pages" type="number" min="1" max="500" value="1"></label>' +
      '</div>' +
      '<div class="form-actions"><button class="btn primary" type="submit">💾 Save chapter</button>' +
      '<button class="btn ghost" type="button" id="btn-cancel" style="display:none">Cancel edit</button></div>';
    var chPhoto = E.media.mediaAttach(editing ? editing.photo : null, { accept: 'image/*', label: 'Photo (optional)', kind: 'photo' });
    var chAudio = E.media.mediaAttach(editing ? editing.audio : null, { accept: 'audio/*', label: 'Audio recording (optional)', kind: 'audio' });
    chForm.appendChild(chPhoto.el);
    chForm.appendChild(chAudio.el);
    wrap.appendChild(chForm);

    var cf = chForm;
    cf.title.value = editing ? editing.title : '';
    cf.pages.value = editing ? pageCount(editing) : 1;
    if (editing) {
      cf.querySelector('#cf-title').textContent = 'Edit chapter';
      cf.querySelector('#btn-cancel').style.display = '';
    }
    cf.querySelector('#btn-cancel').addEventListener('click', function () { editChId = null; LT.render(); });
    cf.addEventListener('submit', function (e) {
      e.preventDefault();
      var title = cf.title.value.trim() || 'Chapter ' + (chs.length + 1);
      var n = Math.max(1, parseInt(cf.pages.value, 10) || 1);
      Promise.all([chPhoto.resolve(editing ? editing.photo : null), chAudio.resolve(editing ? editing.audio : null)]).then(function (res) {
        var d = E.getReading();
        var target = null;
        d.materials.forEach(function (x) { if (x.id === m.id) target = x; });
        if (!target) { toast('Material not found'); return; }
        var ch = { id: editChId || uid(), title: title, pages: n, photo: res[0], audio: res[1] };
        if (editChId) {
          target.chapters = (target.chapters || []).map(function (c) { return c.id === editChId ? ch : c; });
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
          status: 'done', score: null, createdAt: Date.now()
        });
        editChId = null;
        LT.render();
      });
    });

    /* chapter list */
    if (!chs.length) {
      wrap.appendChild(el('p', 'cell-muted', 'No chapters yet — add one above.'));
    }
    chs.forEach(function (ch) {
      var block = el('div', 'chapter-block');
      var head = el('div', 'chapter-head');
      head.innerHTML = '<span class="chev">▶</span><span>' + esc(ch.title) + '</span><span class="ch-meta">' + pageCount(ch) + ' pages</span>';
      block.appendChild(head);
      var body = el('div', 'chapter-body');
      var row = el('div', 'page-row');
      var main = el('div', 'p-main');
      main.appendChild(el('div', 'p-meta', pageCount(ch) + ' pages' + (ch.photo ? ' · 🖼' : '') + (ch.audio ? ' · 🎤' : '')));
      var bar = E.media.rowMediaBar({
        photo: ch.photo || null,
        audio: ch.audio || null,
        allowAudio: true,
        onChange: function (patch) {
          var d = E.getReading();
          d.materials.forEach(function (x) {
            if (x.id !== m.id) return;
            (x.chapters || []).forEach(function (c) { if (c.id === ch.id) { c.photo = patch.photo; c.audio = patch.audio; } });
          });
          E.saveReading(d);
          toast('Attachment saved');
        }
      });
      main.appendChild(bar);
      row.appendChild(main);
      var actions = el('div', 'row-actions');
      var btnEdit = el('button', 'btn ghost small', 'Edit');
      btnEdit.addEventListener('click', function () { editChId = ch.id; LT.render(); });
      var btnDel = el('button', 'btn danger small', 'Delete');
      btnDel.addEventListener('click', function () {
        if (!window.confirm('Delete this chapter?')) return;
        var d = E.getReading();
        d.materials.forEach(function (x) {
          if (x.id !== m.id) return;
          x.chapters = (x.chapters || []).filter(function (c) { return c.id !== ch.id; });
        });
        E.saveReading(d);
        if (editChId === ch.id) editChId = null;
        toast('Chapter deleted');
        LT.render();
      });
      actions.appendChild(btnEdit);
      actions.appendChild(btnDel);
      row.appendChild(actions);
      body.appendChild(row);
      block.appendChild(body);
      wrap.appendChild(block);
    });
  }

  LT.extendModule('english', {
    tabs: [],
    views: { read: readView }
  });
})();