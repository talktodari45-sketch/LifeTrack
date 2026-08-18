/* ============================================================
   LifeTrack — English Learning · Writing (simple log)
   Each entry: title, page count, date, time spent, optional photo.
   No page editor — keep it simple.
   ============================================================ */
(function () {
  'use strict';

  var LT = window.LifeTrack;
  var E = window.LTEnglish;
  var H = LT.helpers;
  var C = LT.charts;
  var esc = H.esc, uid = H.uid, todayISO = H.todayISO;
  var fmtDate = H.fmtDate, fmtMinutes = H.fmtMinutes;
  var el = H.el, toast = H.toast;

  var editId = null;

  function writeView(view) {
    var writing = E.getWriting();
    var entries = writing.entries || [];
    var editing = editId ? (entries.find(function (x) { return x.id === editId; }) || null) : null;

    var wrap = el('div', 'view-body');
    var head = el('div', 'page-head');
    head.innerHTML = '<h1>Writing ✍️</h1><p>Log every writing session: title, pages, date, time — plus a photo if you like.</p>';
    wrap.appendChild(head);

    /* writing dashboard KPIs + volume chart */
    var wTot = E.writingTotals(writing);
    var writeWeek = entries.filter(function (x) { return (x.date || '') >= H.addDays(todayISO(), -6); }).reduce(function (a, x) { return a + (x.pages || 1); }, 0);
    wrap.appendChild(E.ui.statGrid([
      { icon: '📝', label: 'Entries', value: String(entries.length), sub: 'writing sessions', color: '#ec4899' },
      { icon: '📄', label: 'Total pages', value: String(wTot.total), sub: 'all entries', color: '#ec4899' },
      { icon: '⏱️', label: 'Total time', value: fmtMinutes(wTot.minutes), sub: 'time spent writing', color: '#6366f1' },
      { icon: '📅', label: 'Pages this week', value: String(writeWeek), sub: 'last 7 days', color: '#10b981' }
    ]));
    var writeChart = E.ui.card('Writing volume', 'Pages written per day — last 14 days');
    var writeCanvas = el('canvas', 'chart');
    writeChart.appendChild(writeCanvas);
    wrap.appendChild(writeChart);

    /* add / edit form */
    var form = el('form', 'card form-card');
    form.innerHTML =
      '<h2 id="wf-title">Log a writing session</h2><div class="card-sub">Keep it simple: what you wrote, how many pages, when, and for how long.</div>' +
      '<div class="form-grid">' +
      '  <label class="span2">Title<input name="title" type="text" required placeholder="e.g. My morning routine, Travel diary — Day 3"></label>' +
      '  <label>Pages<input name="pages" type="number" min="1" max="200" value="1" required></label>' +
      '  <label>Date<input name="date" type="date" required></label>' +
      '  <label>Time spent (minutes)<input name="timeSpent" type="number" min="0" max="600" placeholder="15"></label>' +
      '</div>' +
      '<div class="form-actions"><button class="btn primary" type="submit">💾 Save entry</button>' +
      '<button class="btn ghost" type="button" id="btn-cancel" style="display:none">Cancel edit</button></div>';
    var wPhoto = E.media.mediaAttach(editing ? editing.photos : null, { accept: 'image/*', label: 'Photo (optional)', kind: 'photo', multiple: true });
    form.appendChild(wPhoto.el);
    wrap.appendChild(form);

    var f = form;
    f.title.value = editing ? editing.title : '';
    f.pages.value = editing ? editing.pages : 1;
    f.date.value = editing ? editing.date : todayISO();
    f.timeSpent.value = editing ? editing.timeSpent : '';
    if (editing) {
      form.querySelector('#wf-title').textContent = 'Edit writing entry';
      f.querySelector('#btn-cancel').style.display = '';
    }
    f.querySelector('#btn-cancel').addEventListener('click', function () { editId = null; LT.render(); });
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var title = f.title.value.trim();
      var pages = parseInt(f.pages.value, 10) || 1;
      if (!title) { toast('Title is required'); return; }
      wPhoto.resolve().then(function (photos) {
        var d = E.getWriting();
        var entry = {
          id: editId || uid(), title: title, pages: Math.max(1, pages),
          date: f.date.value || todayISO(), timeSpent: parseInt(f.timeSpent.value, 10) || 0,
          photos: photos, createdAt: (editing && editing.createdAt) || Date.now()
        };
        if (editId) {
          d.entries = (d.entries || []).map(function (x) { return x.id === editId ? entry : x; });
          toast('Entry updated');
        } else {
          d.entries = (d.entries || []).concat([entry]);
          toast('Entry saved');
        }
        E.saveWriting(d);
        E.upsertRefRecord('writing-entry', entry.id, {
          date: entry.date, activity: 'writing',
          duration: entry.timeSpent, topic: entry.title,
          notes: entry.pages + (entry.pages === 1 ? ' page' : ' pages'),
          status: 'done', score: 0, createdAt: entry.createdAt
        });
        editId = null;
        LT.render();
      });
    });

    /* log list */
    var log = el('div', 'card');
    log.appendChild(el('div', 'card-head', '<h2>Writing log</h2>'));
    var listEl = el('div', 'recent-list');
    if (!entries.length) {
      listEl.appendChild(el('p', 'cell-muted', 'No writing entries yet — log your first session above.'));
    } else {
      entries.slice().sort(function (a, b) {
        return (b.date || '').localeCompare(a.date || '') || ((b.createdAt || 0) - (a.createdAt || 0));
      }).forEach(function (x) {
        var row = el('div', 'recent-row');
        row.innerHTML =
          '<div class="recent-icon" style="background:#ec489918">✍️</div>' +
          '<div class="recent-main"><div class="recent-title">' + esc(x.title) + '</div>' +
          '<div class="recent-sub">' + (x.pages || 1) + ' page' + ((x.pages || 1) === 1 ? '' : 's') + ' · ' + (x.date ? fmtDate(x.date) : 'no date') + ' · ' + (x.timeSpent ? fmtMinutes(x.timeSpent) : '— time') + '</div></div>' +
          '<div class="recent-side">' +
          '<button class="btn ghost small btn-edit">Edit</button>' +
          '<button class="btn danger small btn-del">Delete</button></div>';
        row.querySelector('.btn-edit').addEventListener('click', function () { editId = x.id; LT.render(); });
        row.querySelector('.btn-del').addEventListener('click', function () {
          if (!window.confirm('Delete this writing entry?')) return;
          var d = E.getWriting();
          d.entries = (d.entries || []).filter(function (y) { return y.id !== x.id; });
          E.saveWriting(d);
          E.getRecords().filter(function (r) { return r.ref && r.ref.type === 'writing-entry' && r.ref.id === x.id; })
            .forEach(function (r) { E.deleteRecord(r.id); });
          if (editId === x.id) editId = null;
          toast('Entry deleted');
          LT.render();
        });
        var bar = E.media.rowMediaBar({
          photos: x.photos || [],
          allowAudio: false,
          onChange: function (patch) {
            var d = E.getWriting();
            d.entries = (d.entries || []).map(function (y) { return y.id === x.id ? Object.assign({}, y, { photos: patch.photos }) : y; });
            E.saveWriting(d);
            toast('Photo saved');
          }
        });
        row.querySelector('.recent-main').appendChild(bar);
        listEl.appendChild(row);
      });
    }
    log.appendChild(listEl);
    wrap.appendChild(log);
    view.appendChild(wrap);

    var writeSeries = E.seriesBuckets(entries, 'day', function (x) { return x.pages || 1; });
    C.barChart(writeCanvas, { labels: writeSeries.labels, values: writeSeries.values, color: '#ec4899', format: function (v) { return String(Math.round(v)); } });
  }

  LT.extendModule('english', {
    tabs: [],
    views: { write: writeView }
  });
})();