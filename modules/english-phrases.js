/* ============================================================
   LifeTrack — English Learning · Common Phrases
   Simple daily counter: log how many phrases you learned, plus
   an optional photo of the phrases.
   ============================================================ */
(function () {
  'use strict';

  var LT = window.LifeTrack;
  var E = window.LTEnglish;
  var H = LT.helpers;
  var esc = H.esc, uid = H.uid, todayISO = H.todayISO;
  var fmtDate = H.fmtDate;
  var el = H.el, toast = H.toast;

  function phrasesView(view) {
    var goals = E.getGoals();
    var today = todayISO();
    var list = E.getPhrases();
    var byDay = E.phrasesByDay();
    var todayCount = byDay[today] || 0;
    var total = E.phrasesTotal();

    /* today's entry (for merging + photo) */
    var todayEntry = null;
    list.forEach(function (p) { if (p.date === today && typeof p.count === 'number') todayEntry = p; });
    var todayPhoto = todayEntry ? ((todayEntry.photos && todayEntry.photos[0]) || todayEntry.photo || null) : null;

    /* photo by day (for the recent list) */
    var photoByDay = {};
    list.forEach(function (p) {
      var d = p.date || p.learned;
      var ph = (p.photos && p.photos[0]) || p.photo || null;
      if (d && ph) photoByDay[d] = ph;
    });

    var wrap = el('div', 'view-body');
    var head = el('div', 'page-head');
    head.innerHTML = '<h1>Common Phrases 💬</h1><p>Learn a few new phrases every day — log how many and snap a photo of them.</p>';
    wrap.appendChild(head);

    /* today goal */
    var goalCard = el('div', 'card');
    goalCard.appendChild(el('h2', null, 'Today'));
    goalCard.appendChild(el('div', 'card-sub', 'Learned ' + todayCount + ' of ' + goals.phrases + ' phrases today · ' + total + ' all time'));
    goalCard.appendChild(E.ui.goalRow('💬', E.ACTIVITIES.phrases.color, 'Phrases learned today', todayCount, goals.phrases, 'phrases'));
    wrap.appendChild(goalCard);

    /* counter + optional photo */
    var form = el('form', 'card form-card');
    form.innerHTML =
      '<h2>Log phrases</h2><div class="card-sub">How many new phrases did you learn today?</div>' +
      '<div class="form-grid">' +
      '  <label>How many phrases<input name="count" type="number" min="1" max="50" value="1"></label>' +
      '</div>' +
      '<div class="form-actions"><button class="btn primary" type="submit">➕ Add to today</button></div>';
    wrap.appendChild(form);
    var phPhoto = E.media.mediaAttach(todayPhoto, { accept: 'image/*', label: 'Photo (optional)', kind: 'photo' });
    form.appendChild(phPhoto.el);

    /* recent days */
    var histCard = el('div', 'card');
    histCard.appendChild(el('h2', null, 'Recent days'));
    var days = Object.keys(byDay).sort().reverse().slice(0, 14);
    var hlist = el('div', 'recent-list');
    if (!days.length) hlist.appendChild(el('p', 'cell-muted', 'Nothing logged yet — add today\u2019s phrases above.'));
    days.forEach(function (d) {
      var ph = photoByDay[d];
      var row = el('div', 'recent-row');
      row.innerHTML =
        '<div class="recent-icon" style="background:#06b6d418">💬</div>' +
        '<div class="recent-main"><div class="recent-title">' + byDay[d] + ' phrase' + (byDay[d] === 1 ? '' : 's') + '</div>' +
        '<div class="recent-sub">' + esc(fmtDate(d)) + '</div>' +
        (ph ? '<img src="' + ph + '" alt="Phrase photo" style="max-width:160px;max-height:120px;border-radius:10px;border:1px solid var(--line);margin-top:6px;display:block">' : '') +
        '</div>' +
        '<div class="recent-side"><div class="v">' + (d === today ? 'today' : '') + '</div></div>';
      hlist.appendChild(row);
    });
    histCard.appendChild(hlist);
    wrap.appendChild(histCard);

    view.appendChild(wrap);

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var n = Math.max(1, parseInt(form.count.value, 10) || 1);
      phPhoto.resolve(todayPhoto).then(function (photo) {
        var photos = photo ? [photo] : [];
        var list2 = E.getPhrases();
        var entry = null;
        list2.forEach(function (p) { if (p.date === today && typeof p.count === 'number') entry = p; });
        if (entry) {
          entry.count += n;
          entry.photos = photos;
        } else {
          list2.push({ id: uid(), date: today, count: n, photos: photos });
        }
        E.savePhrases(list2);
        E.addRecord({
          date: today, activity: 'phrases', duration: 0,
          topic: 'Learned ' + n + ' phrase' + (n === 1 ? '' : 's'),
          notes: '',
          status: 'done', createdAt: Date.now()
        });
        toast('Added ' + n + ' phrase' + (n === 1 ? '' : 's') + ' — ' + ((byDay[today] || 0) + n) + ' today');
        LT.render();
      });
    });
  }

  LT.extendModule('english', {
    tabs: [],
    views: { phrases: phrasesView }
  });
})();
