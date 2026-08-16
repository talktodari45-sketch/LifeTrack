/* ============================================================
   LifeTrack — core engine
   Store (localStorage) · hash router · module registry · charts
   ============================================================ */
(function () {
  'use strict';

  var LS_PREFIX = 'lifetrack.';
  var FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

  /* ---------------- Store ---------------- */
  var Store = {
    get: function (key, fallback) {
      try {
        var raw = localStorage.getItem(LS_PREFIX + key);
        return raw === null ? fallback : JSON.parse(raw);
      } catch (e) { return fallback; }
    },
    set: function (key, value) {
      try { localStorage.setItem(LS_PREFIX + key, JSON.stringify(value)); } catch (e) { try { toast('Storage full — free up space or remove large attachments'); } catch (_) { /* noop */ } }
    },
    remove: function (key) {
      try { localStorage.removeItem(LS_PREFIX + key); } catch (e) { /* ignore */ }
    }
  };

  /* ---------------- Helpers ---------------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }
  function pad(n) { return String(n).padStart(2, '0'); }
  function toISO(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function todayISO() { return toISO(new Date()); }
  function parseISO(iso) {
    var p = String(iso).split('-');
    return new Date(+p[0], +p[1] - 1, +p[2]);
  }
  function addDays(iso, n) {
    var d = parseISO(iso);
    d.setDate(d.getDate() + n);
    return toISO(d);
  }
  function startOfWeek(iso) {
    var d = parseISO(iso);
    var day = (d.getDay() + 6) % 7; // Monday = 0
    d.setDate(d.getDate() - day);
    return toISO(d);
  }
  function fmtDate(iso) {
    return parseISO(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }
  function fmtDay(iso) {
    return parseISO(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
  function fmtMinutes(min) {
    min = Math.round(min || 0);
    var h = Math.floor(min / 60), m = min % 60;
    return h > 0 ? (h + 'h ' + pad(m) + 'm') : (m + 'm');
  }
  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  function toast(msg) {
    var wrap = document.getElementById('toast-wrap');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = 'toast-wrap';
      document.body.appendChild(wrap);
    }
    var t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    wrap.appendChild(t);
    requestAnimationFrame(function () { t.classList.add('show'); });
    setTimeout(function () {
      t.classList.remove('show');
      setTimeout(function () { t.remove(); }, 300);
    }, 2600);
  }

  /* ---------------- Canvas charts ---------------- */
  var chartDraws = [];
  function setupCanvas(canvas) {
    var dpr = window.devicePixelRatio || 1;
    var rect = canvas.getBoundingClientRect();
    var w = Math.max(rect.width, 10), h = Math.max(rect.height, 10);
    var pw = Math.round(w * dpr), ph = Math.round(h * dpr);
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw;
      canvas.height = ph;
    }
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return { ctx: ctx, w: w, h: h };
  }
  function niceMax(v) {
    if (v <= 0) return 1;
    var exp = Math.pow(10, Math.floor(Math.log10(v)));
    var f = v / exp;
    var nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
    return nf * exp;
  }
  function roundRectPath(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h);
    ctx.beginPath();
    ctx.moveTo(x, y + h);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h);
    ctx.closePath();
  }
  function gridlines(ctx, padL, padT, plotW, plotH, w, h, max, fmt) {
    ctx.font = '10px ' + FONT;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#9aa1b5';
    for (var i = 0; i <= 4; i++) {
      var y = padT + plotH - (plotH * i / 4);
      ctx.strokeStyle = '#eef0f5';
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(padL + plotW, y);
      ctx.stroke();
      ctx.fillText(fmt ? fmt(max * i / 4) : String(Math.round(max * i / 4)), padL - 6, y);
    }
  }
  function xLabels(ctx, labels, xs, w, h) {
    ctx.font = '10px ' + FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#9aa1b5';
    var n = labels.length;
    var step = Math.max(1, Math.ceil(n / 12));
    for (var i = 0; i < n; i += step) {
      ctx.fillText(labels[i], xs[i], h - 8);
    }
  }
  function traceSmooth(ctx, pts) {
    ctx.moveTo(pts[0].x, pts[0].y);
    for (var i = 0; i < pts.length - 1; i++) {
      var mx = (pts[i].x + pts[i + 1].x) / 2;
      var my = (pts[i].y + pts[i + 1].y) / 2;
      ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
    }
    ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
  }
  function drawLineSeries(ctx, xs, ys, color, baselineY, fill) {
    var pts = [];
    for (var i = 0; i < xs.length; i++) {
      if (ys[i] != null) pts.push({ x: xs[i], y: ys[i] });
    }
    if (pts.length === 0) return;
    if (pts.length === 1) {
      ctx.beginPath();
      ctx.arc(pts[0].x, pts[0].y, 3, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      return;
    }
    if (fill) {
      ctx.beginPath();
      traceSmooth(ctx, pts);
      ctx.lineTo(pts[pts.length - 1].x, baselineY);
      ctx.lineTo(pts[0].x, baselineY);
      ctx.closePath();
      var g = ctx.createLinearGradient(0, 0, 0, baselineY);
      g.addColorStop(0, color + '33');
      g.addColorStop(1, color + '00');
      ctx.fillStyle = g;
      ctx.fill();
    }
    ctx.beginPath();
    traceSmooth(ctx, pts);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();
    pts.forEach(function (p) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2.6, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.6;
      ctx.stroke();
    });
  }
  function barChart(canvas, opts) {
    var draw = function () {
      var s = setupCanvas(canvas);
      var ctx = s.ctx, w = s.w, h = s.h;
      var padL = 40, padR = 10, padT = 18, padB = 26;
      var plotW = w - padL - padR, plotH = h - padT - padB;
      var labels = opts.labels, values = opts.values;
      var n = labels.length;
      var max = niceMax(Math.max.apply(null, values.concat([0])));
      gridlines(ctx, padL, padT, plotW, plotH, w, h, max, opts.format);
      var slot = plotW / n;
      var barW = Math.min(slot * 0.55, 30);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      values.forEach(function (v, i) {
        var x = padL + slot * i + (slot - barW) / 2;
        var bh = plotH * v / max;
        var y = padT + plotH - bh;
        roundRectPath(ctx, x, y, barW, bh, Math.min(4, barW / 2));
        ctx.fillStyle = opts.color;
        ctx.fill();
        if (v > 0 && n <= 16 && bh > 16) {
          ctx.fillStyle = '#7c8298';
          ctx.font = '9px ' + FONT;
          ctx.fillText(String(v), x + barW / 2, y - 4);
        }
      });
      var xs = labels.map(function (_, i) { return padL + slot * i + slot / 2; });
      xLabels(ctx, labels, xs, w, h);
    };
    chartDraws.push(draw);
    draw();
  }
  function comboChart(canvas, opts) {
    var draw = function () {
      var s = setupCanvas(canvas);
      var ctx = s.ctx, w = s.w, h = s.h;
      var padL = 40, padR = 44, padT = 16, padB = 26;
      var plotW = w - padL - padR, plotH = h - padT - padB;
      var labels = opts.labels, barVals = opts.bars.values, lineVals = opts.line.values;
      var n = labels.length;
      var maxBar = niceMax(Math.max.apply(null, barVals.concat([0])));
      var lineValid = lineVals.filter(function (v) { return v != null; });
      var maxLine = Math.max.apply(null, lineValid.concat([0]));
      gridlines(ctx, padL, padT, plotW, plotH, w, h, maxBar, opts.bars.format);
      var slot = plotW / n;
      var barW = Math.min(slot * 0.5, 28);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      barVals.forEach(function (v, i) {
        var x = padL + slot * i + (slot - barW) / 2;
        var bh = plotH * v / maxBar;
        var y = padT + plotH - bh;
        roundRectPath(ctx, x, y, barW, bh, Math.min(4, barW / 2));
        ctx.fillStyle = opts.bars.color;
        ctx.fill();
        if (v > 0 && n <= 16 && bh > 16) {
          ctx.fillStyle = '#7c8298';
          ctx.font = '9px ' + FONT;
          ctx.fillText(String(v), x + barW / 2, y - 4);
        }
      });
      ctx.font = '10px ' + FONT;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillStyle = opts.line.color;
      ctx.fillText(String(maxLine) + (opts.line.unit || ''), w - padR + 6, padT);
      var xs = labels.map(function (_, i) { return padL + slot * i + slot / 2; });
      var ys = lineVals.map(function (v) {
        return v == null ? null : padT + plotH - (plotH * v / (maxLine || 1));
      });
      drawLineSeries(ctx, xs, ys, opts.line.color, padT + plotH, true);
      xLabels(ctx, labels, xs, w, h);
    };
    chartDraws.push(draw);
    draw();
  }
  function lineChart(canvas, opts) {
    var draw = function () {
      var s = setupCanvas(canvas);
      var ctx = s.ctx, w = s.w, h = s.h;
      var padL = 40, padR = 12, padT = 16, padB = 26;
      var plotW = w - padL - padR, plotH = h - padT - padB;
      var labels = opts.labels, values = opts.values;
      var n = labels.length;
      var min = opts.range ? opts.range.min : 0;
      var max = opts.range ? opts.range.max : niceMax(Math.max.apply(null, values.filter(function (v) { return v != null; }).concat([0])));
      gridlines(ctx, padL, padT, plotW, plotH, w, h, max - min, function (v) { return String(Math.round(min + v)); });
      var xs = labels.map(function (_, i) { return n === 1 ? padL + plotW / 2 : padL + plotW * i / (n - 1); });
      var ys = values.map(function (v) {
        return v == null ? null : padT + plotH - (plotH * (v - min) / (max - min));
      });
      drawLineSeries(ctx, xs, ys, opts.color, padT + plotH, opts.fill !== false);
      xLabels(ctx, labels, xs, w, h);
    };
    chartDraws.push(draw);
    draw();
  }
  function donutChart(canvas, opts) {
    var draw = function () {
      var s = setupCanvas(canvas);
      var ctx = s.ctx, w = s.w, h = s.h;
      var segs = opts.segments.filter(function (x) { return x.value > 0; });
      var total = segs.reduce(function (a, x) { return a + x.value; }, 0);
      var cx = w / 2, cy = h / 2;
      var rOut = Math.min(w, h) / 2 - 8;
      var rIn = rOut * 0.6;
      if (!total) {
        ctx.beginPath();
        ctx.arc(cx, cy, rOut, 0, Math.PI * 2);
        ctx.arc(cx, cy, rIn, Math.PI * 2, 0, true);
        ctx.closePath();
        ctx.fillStyle = '#eef0f5';
        ctx.fill();
      } else {
        var a0 = -Math.PI / 2;
        var gap = segs.length > 1 ? 0.035 : 0;
        segs.forEach(function (seg) {
          var a1 = a0 + (seg.value / total) * Math.PI * 2 - gap;
          ctx.beginPath();
          ctx.arc(cx, cy, rOut, a0, a1);
          ctx.arc(cx, cy, rIn, a1, a0, true);
          ctx.closePath();
          ctx.fillStyle = seg.color;
          ctx.fill();
          a0 = a1 + gap;
        });
      }
      ctx.fillStyle = '#191c29';
      ctx.font = '800 22px ' + FONT;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(opts.centerValue != null ? opts.centerValue : total), cx, cy - 7);
      ctx.fillStyle = '#9aa1b5';
      ctx.font = '11px ' + FONT;
      ctx.fillText(opts.centerLabel || '', cx, cy + 14);
    };
    chartDraws.push(draw);
    draw();
  }
  function resetCharts() { chartDraws.length = 0; }
  var resizeTimer = null;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      chartDraws.forEach(function (fn) { try { fn(); } catch (e) { /* detached canvas */ } });
    }, 150);
  });

  /* ---------------- Router / shell ---------------- */
  var FUTURE_MODULES = [
    { id: 'ai', name: 'Agentic AI Study', icon: '🤖', locked: true },
    { id: 'gym', name: 'Gym Tracker', icon: '💪', locked: true }
  ];

  function currentRoute() {
    var h = location.hash.replace(/^#\/?/, '');
    var parts = h.split('/').filter(Boolean);
    return { moduleId: parts[0] || null, view: (parts[1] || '').split('?')[0] || null };
  }
  function navItem(id, view, icon, label, locked) {
    var a = el('a', 'nav-item' + (id === currentRoute().moduleId && view === (currentRoute().view || 'dashboard') && !locked ? ' active' : '') + (locked ? ' locked' : ''));
    a.innerHTML = '<span class="nav-icon">' + icon + '</span><span class="nav-label">' + esc(label) + '</span>' + (locked ? '<span class="nav-badge">soon</span>' : '');
    if (locked) {
      a.addEventListener('click', function (e) {
        e.preventDefault();
        toast(label + ' — coming soon. This module isn\u2019t built yet.');
      });
    } else {
      a.href = '#/' + id + '/' + view;
    }
    return a;
  }
  function renderNav() {
    var nav = document.getElementById('module-nav');
    if (!nav) return;
    nav.innerHTML = '';
    var route = currentRoute();
    var activeMod = window.LifeTrack.modules[route.moduleId];
    if (activeMod) {
      nav.appendChild(el('div', 'nav-group', esc(activeMod.name)));
      activeMod.tabs.forEach(function (t) {
        nav.appendChild(navItem(activeMod.id, t.id, t.icon || '', t.label, false));
      });
    }
    Object.keys(window.LifeTrack.modules).forEach(function (k) {
      if (k === route.moduleId) return;
      var m = window.LifeTrack.modules[k];
      nav.appendChild(el('div', 'nav-group', esc(m.name)));
      nav.appendChild(navItem(m.id, 'dashboard', m.icon, m.name, false));
    });
    FUTURE_MODULES.forEach(function (m) {
      nav.appendChild(navItem(m.id, 'dashboard', m.icon, m.name, true));
    });
  }
  function render() {
    resetCharts();
    var route = currentRoute();
    renderNav();
    var view = document.getElementById('view');
    view.innerHTML = '';
    var mod = window.LifeTrack.modules[route.moduleId];
    if (!mod) {
      location.hash = '#/english/dashboard';
      return;
    }
    var v = mod.views[route.view] || mod.views.dashboard;
    v(view);
  }

  /* ---------------- Public API ---------------- */
  window.LifeTrack = {
    Store: Store,
    helpers: {
      esc: esc, uid: uid, toISO: toISO, todayISO: todayISO, parseISO: parseISO,
      addDays: addDays, startOfWeek: startOfWeek, fmtDate: fmtDate, fmtDay: fmtDay,
      fmtMinutes: fmtMinutes, el: el, toast: toast
    },
    charts: {
      barChart: barChart, comboChart: comboChart, lineChart: lineChart,
      donutChart: donutChart, reset: resetCharts
    },
    modules: {},
    registerModule: function (mod) { window.LifeTrack.modules[mod.id] = mod; },
    extendModule: function (modId, ext) {
      var m = window.LifeTrack.modules[modId];
      if (!m) return;
      if (ext.views) Object.keys(ext.views).forEach(function (k) { m.views[k] = ext.views[k]; });
      if (ext.tabs) ext.tabs.forEach(function (t) { m.tabs.push(t); });
    },
    render: render,
    boot: function () {
      if (!location.hash) {
        location.hash = '#/english/dashboard';
      }
      render();
      window.addEventListener('hashchange', render);
    }
  };
})();
