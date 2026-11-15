/* "Living field": a canvas wheat field that lives through every real year of NASA weather.
 * Dry years turn it straw-brown, good years green-gold, windy years make it sway, rainy years bring rain.
 * HeroField.start(canvas, years, onYear) — years: [{year, cls:'ok'|'dent'|'crash', rain, wind}] */
(function (root) {
  'use strict';
  var reduce = false;
  try { reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { /* ignore */ }

  function lerp(a, b, k) { return a + (b - a) * k; }
  function mix(c1, c2, k) { return [lerp(c1[0], c2[0], k), lerp(c1[1], c2[1], k), lerp(c1[2], c2[2], k)]; }
  function rgb(c, a) { return 'rgba(' + Math.round(c[0]) + ',' + Math.round(c[1]) + ',' + Math.round(c[2]) + ',' + (a === undefined ? 1 : a) + ')'; }

  // palette per outcome: stem, ear
  var PAL = {
    ok: { stem: [104, 178, 92], ear: [240, 204, 104] },
    dent: { stem: [176, 168, 78], ear: [236, 186, 86] },
    crash: { stem: [158, 112, 64], ear: [190, 132, 76] }
  };

  function start(canvas, years, onYear) {
    if (!canvas || !canvas.getContext || !years || !years.length) return null;
    var ctx = canvas.getContext('2d');
    var W = 0, H = 0, dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    var stalks = [], drops = [];
    var running = true, visible = true;
    var t0 = performance.now(), YEAR_MS = 520, HOLD_MS = 2600;
    var idx = 0, lastIdx = -1;
    var cur = { stem: PAL.ok.stem.slice(), ear: PAL.ok.ear.slice(), sway: 0.4, rain: 0 };

    function build() {
      var r = canvas.getBoundingClientRect();
      W = Math.max(320, r.width); H = Math.max(200, r.height);
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      stalks = [];
      var horizon = H * 0.38, rows = 30;
      for (var i = 0; i < rows; i++) {
        var depth = i / (rows - 1);                    // 0 far … 1 near
        var y = horizon + Math.pow(depth, 1.7) * (H - horizon);
        var scale = 0.25 + depth * 1.05;
        var n = Math.round(34 + depth * 26);
        for (var j = 0; j < n; j++) {
          var x = (j + Math.random() * 0.8) / n * (W * (1.15 + depth * 0.3)) - W * (0.08 + depth * 0.15);
          stalks.push({ x: x, y: y + Math.random() * 3, h: (34 + Math.random() * 22) * scale, w: Math.max(0.8, 1.8 * scale), ph: Math.random() * 6.28, d: depth });
        }
      }
      stalks.sort(function (a, b) { return a.d - b.d; });
    }

    function frame(now) {
      if (!running) return;
      requestAnimationFrame(frame);
      if (!visible) return;
      var el = Math.max(0, now - t0), cycle = years.length * YEAR_MS + HOLD_MS;
      var pos = (el % cycle);
      idx = Math.max(0, Math.min(years.length - 1, Math.floor(pos / YEAR_MS)));
      var Y = years[idx];
      if (idx !== lastIdx) { lastIdx = idx; if (onYear) onYear(Y, idx); }
      // ease colours and wind towards the current year
      var target = PAL[Y.cls] || PAL.ok;
      cur.stem = mix(cur.stem, target.stem, 0.06); cur.ear = mix(cur.ear, target.ear, 0.06);
      cur.sway = lerp(cur.sway, 0.25 + Math.min(1.2, Y.wind) * 0.9, 0.05);
      cur.rain = lerp(cur.rain, Y.rainy ? 1 : 0, 0.05);
      draw(now / 1000);
    }

    function draw(t) {
      ctx.clearRect(0, 0, W, H);
      // ground haze
      var g = ctx.createLinearGradient(0, H * 0.35, 0, H);
      g.addColorStop(0, 'rgba(201,146,46,0)');
      g.addColorStop(1, rgb(mix(cur.stem, [40, 30, 20], 0.55), 0.55));
      ctx.fillStyle = g; ctx.fillRect(0, H * 0.35, W, H);
      ctx.lineCap = 'round';
      for (var i = 0; i < stalks.length; i++) {
        var s = stalks[i];
        var gust = Math.sin(t * 1.3 + s.x * 0.012) * 0.6 + Math.sin(t * 0.7 + s.x * 0.004) * 0.4;
        var sway = (gust * cur.sway + Math.sin(t * 2.1 + s.ph) * 0.12) * s.h * 0.35;
        var alpha = 0.5 + s.d * 0.5;
        ctx.strokeStyle = rgb(cur.stem, alpha);
        ctx.lineWidth = s.w;
        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.quadraticCurveTo(s.x + sway * 0.3, s.y - s.h * 0.55, s.x + sway, s.y - s.h);
        ctx.stroke();
        // ear
        ctx.fillStyle = rgb(cur.ear, alpha);
        ctx.beginPath();
        ctx.ellipse(s.x + sway * 1.02, s.y - s.h - s.h * 0.1, s.w * 1.3, s.h * 0.14, sway * 0.02, 0, 6.283);
        ctx.fill();
      }
      // rain in wet years
      if (cur.rain > 0.05) {
        if (drops.length < 140) for (var k = 0; k < 6; k++) drops.push({ x: Math.random() * W * 1.2, y: -10, v: 6 + Math.random() * 6 });
        ctx.strokeStyle = 'rgba(170,205,240,' + (0.35 * cur.rain) + ')'; ctx.lineWidth = 1;
        ctx.beginPath();
        for (var d = drops.length - 1; d >= 0; d--) {
          var p = drops[d]; p.y += p.v; p.x -= p.v * 0.25;
          ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + 2.5, p.y - 10);
          if (p.y > H) drops.splice(d, 1);
        }
        ctx.stroke();
      } else drops.length = 0;
    }

    build();
    var ro = null;
    if ('ResizeObserver' in window) { ro = new ResizeObserver(function () { build(); }); ro.observe(canvas); }
    if ('IntersectionObserver' in window) new IntersectionObserver(function (es) { visible = es[0].isIntersecting; }).observe(canvas);
    document.addEventListener('visibilitychange', function () { visible = !document.hidden; });
    if (reduce) {
      // one calm still frame of a good year
      cur = { stem: PAL.ok.stem, ear: PAL.ok.ear, sway: 0, rain: 0 };
      draw(0);
      if (onYear) onYear(years[years.length - 1], years.length - 1);
      return { stop: function () {} };
    }
    requestAnimationFrame(frame);
    return { stop: function () { running = false; if (ro) ro.disconnect(); } };
  }

  /** Short intro curtain, once per browser session. */
  function intro() {
    var done = false;
    try { done = sessionStorage.getItem('crt-intro') === '1'; sessionStorage.setItem('crt-intro', '1'); } catch (e) { /* ignore */ }
    if (done || reduce) return;
    var d = document.createElement('div');
    d.className = 'intro';
    d.innerHTML = '<div class="intro-in"><img src="assets/logo.svg" alt="" width="84" height="84"><div class="intro-t">' +
      document.title + '</div><div class="intro-bar"><i></i></div></div><div class="intro-half top"></div><div class="intro-half bottom"></div>';
    document.body.appendChild(d);
    d.addEventListener('click', function () { d.classList.add('out'); });
    setTimeout(function () { d.classList.add('out'); }, 1500);
    setTimeout(function () { d.remove(); }, 2400);
  }

  root.HeroField = { start: start, intro: intro };
})(this);
