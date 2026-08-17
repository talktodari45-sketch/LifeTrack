/* ============================================================
   LifeTrack — English Learning · Common Phrases
   Goal: learn 5 phrases a day. Save phrase, meaning, example,
   notes — and keep reviewing until they stick.
   ============================================================ */
(function () {
  'use strict';

  var LT = window.LifeTrack;
  var E = window.LTEnglish;
  var H = LT.helpers;
  var esc = H.esc, uid = H.uid, todayISO = H.todayISO;
  var fmtDate = H.fmtDate;
  var el = H.el, toast = H.toast;

  var phraseEditId = null;

  function phrasesView(view) {
    var phrases = E.getPhrases();
    var goals = E.getGoals();
    var today = todayISO();
    var learnedToday = phrases.filter(function (p) { return p.learned === today; }).length;
    var reviewedToday = phrases.filter(function (p) { return p.lastReview === today; }).length;

    var wrap = el('div', 'view-body');
    var head = el('div', 'page-head');
    head.innerHTML = '<h1>Common Phrases 💬</h1><p>Goal: learn 5 phrases per day. Save the phrase, its meaning and an example — then review until they feel natural.</p>';
    wrap.appendChild(head);

    var goalCard = el('div', 'card');
    goalCard.appendChild(el('h2', null, 'Today'));
    goalCard.appendChild(el('div', 'card-sub', 'Learned ' + learnedToday + ' of ' + goals.phrases + ' phrases today' + (reviewedToday ? ' · ' + reviewedToday + ' reviewed' : '')));
    goalCard.appendChild(E.ui.goalRow('💬', E.ACTIVITIES.phrases.color, 'Phrases learned today', learnedToday, goals.phrases, 'phrases'));
    wrap.appendChild(goalCard);

    /* add / edit form */
    var form = el('form', 'card form-card');
    form.innerHTML =
      '<h2 id="form-title">Add a phrase</h2>' +
      '<div class="form-grid">' +
      '  <label class="span2">Phrase<input name="phrase" type="text" required placeholder="e.g. I am looking forward to it"></label>' +
      '  <label>Meaning<textarea name="meaning" rows="2" required placeholder="What does it mean? When do you use it?"></textarea></label>' +
      '  <label>Example<textarea name="example" rows="2" placeholder="A sentence using the phrase"></textarea></label>' +
      '  <label class="span2">Notes<textarea name="notes" rows="2" placeholder="Memory hook, similar phrases…"></textarea></label>' +
      '</div>' +
      '<div class="form-actions"><button class="btn primary" type="submit">➕ Save phrase</button>' +
      '<button class="btn ghost" type="button" id="btn-cancel" style="display:none">Cancel edit</button></div>';
    wrap.appendChild(form);
    var phPhoto = E.media.mediaAttach(phraseEditId ? (((phrases.find(function (p) { return p.id === phraseEditId; }) || {}).photos || [])[0] || null) : null, { accept: 'image/*', label: 'Photo (optional)', kind: 'photo' });
    form.appendChild(phPhoto.el);

    /* list */
    var learning = phrases.filter(function (p) { return p.status !== 'learned'; });
    var learned = phrases.filter(function (p) { return p.status === 'learned'; });
    var listCard = el('div', 'card');
    listCard.appendChild(el('h2', null, 'Learning (' + learning.length + ')'));
    var llist = el('div', 'mat-list');
    if (!learning.length) llist.appendChild(el('p', 'cell-muted', 'Nothing in the learning queue — add a phrase above.'));
    learning.forEach(function (p) { llist.appendChild(phraseCard(p, false)); });
    listCard.appendChild(llist);
    wrap.appendChild(listCard);

    if (learned.length) {
      var doneCard = el('div', 'card');
      doneCard.appendChild(el('h2', null, 'Learned (' + learned.length + ')'));
      var dlist = el('div', 'mat-list');
      learned.forEach(function (p) { dlist.appendChild(phraseCard(p, true)); });
      doneCard.appendChild(dlist);
      wrap.appendChild(doneCard);
    }
    view.appendChild(wrap);

    /* wiring */
    var f = form;
    if (phraseEditId) {
      var rec = phrases.find(function (p) { return p.id === phraseEditId; });
      if (rec) {
        f.phrase.value = rec.phrase; f.meaning.value = rec.meaning || '';
        f.example.value = rec.example || ''; f.notes.value = rec.notes || '';
        document.getElementById('form-title').textContent = 'Edit phrase';
        document.getElementById('btn-cancel').style.display = '';
      } else phraseEditId = null;
    }
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var phrase = f.phrase.value.trim();
      var meaning = f.meaning.value.trim();
      if (!phrase || !meaning) { toast('Phrase and meaning are required'); return; }
      var prevPhoto = phraseEditId ? (((E.getPhrases().find(function (p) { return p.id === phraseEditId; }) || {}).photos || [])[0] || null) : null;
      phPhoto.resolve(prevPhoto).then(function (photo) {
      var photos = photo ? [photo] : [];
      if (phraseEditId) {
        var list = E.getPhrases().map(function (p) {
          if (p.id !== phraseEditId) return p;
          p.phrase = phrase; p.meaning = meaning;
          p.example = f.example.value.trim(); p.notes = f.notes.value.trim();
          p.photos = photos;
          return p;
        });
        E.savePhrases(list);
        toast('Phrase updated');
        phraseEditId = null;
        LT.render();
        return;
      }
      var np = {
        id: uid(), phrase: phrase, meaning: meaning,
        example: f.example.value.trim(), notes: f.notes.value.trim(),
        learned: todayISO(), lastReview: null, reviews: 0, status: 'learning',
        photos: photos
      };
      E.savePhrases(E.getPhrases().concat([np]));
      E.addRecord({
        date: np.learned, activity: 'phrases', duration: 0,
        topic: 'Learned: ' + phrase, notes: meaning,
        status: 'done', createdAt: Date.now()
      });
      toast('Phrase saved — ' + (learnedToday + 1) + ' today');
      LT.render();
      });
    });
    document.getElementById('btn-cancel').addEventListener('click', function () { phraseEditId = null; LT.render(); });
  }

  function phraseCard(p, isLearned) {
    var card = el('div', 'phrase-card');
    var photos = (p.photos && p.photos.length) ? p.photos : [];
    card.innerHTML =
      '<div class="phrase-main">' +
      '<div class="phrase-text">' + esc(p.phrase) + '</div>' + photos.map(function (url) { return '<img src="' + url + '" alt="Phrase photo" style="max-width:200px;max-height:150px;border-radius:10px;border:1px solid var(--line);margin-top:6px;display:block">'; }).join('') +
      '<div class="phrase-meaning">' + esc(p.meaning) + '</div>' +
      (p.example ? '<div class="phrase-example">" ' + esc(p.example) + ' "</div>' : '') +
      (p.notes ? '<div class="phrase-example">📌 ' + esc(p.notes) + '</div>' : '') +
      '<div class="p-meta" style="font-size:11.5px;color:var(--faint);margin-top:5px">learned ' + fmtDate(p.learned) +
      (p.reviews ? ' · reviewed ' + p.reviews + '×' : '') + (p.lastReview ? ' · last ' + fmtDate(p.lastReview) : '') + '</div>' +
      '</div>' +
      '<div class="phrase-side">' +
      (isLearned ? '<span class="st-chip st-completed">Learned ✓</span>' : '<span class="st-chip st-in-progress">Learning</span>') +
      '<div style="display:flex;gap:6px">' +
      '<button class="btn ghost small btn-review" title="Mark as reviewed today">🔄 Review</button>' +
      '<button class="btn ghost small btn-edit" title="Edit">✏️</button>' +
      '<button class="btn danger small btn-del" title="Delete">🗑️</button>' +
      '</div></div>';
    card.querySelector('.btn-review').addEventListener('click', function () {
      var list = E.getPhrases().map(function (x) {
        if (x.id !== p.id) return x;
        x.reviews = (x.reviews || 0) + 1;
        x.lastReview = todayISO();
        if (x.reviews >= 3) x.status = 'learned';
        return x;
      });
      E.savePhrases(list);
      toast(p.reviews + 1 >= 3 ? 'Phrase marked as learned 🎉' : 'Reviewed — ' + (p.reviews + 1) + ' of 3 reviews');
      LT.render();
    });
    card.querySelector('.btn-edit').addEventListener('click', function () { phraseEditId = p.id; LT.render(); });
    card.querySelector('.btn-del').addEventListener('click', function () {
      if (!window.confirm('Delete phrase "' + p.phrase + '"?')) return;
      E.savePhrases(E.getPhrases().filter(function (x) { return x.id !== p.id; }));
      toast('Phrase deleted');
      LT.render();
    });
    return card;
  }

  LT.extendModule('english', {
    tabs: [],
    views: { phrases: phrasesView }
  });
})();
