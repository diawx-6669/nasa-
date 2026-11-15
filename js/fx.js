/* Motion & comfort layer: scroll reveal, count-up numbers, tooltips, toasts, scroll progress, scroll-spy.
 * Everything degrades gracefully: with prefers-reduced-motion all content is shown at once. */
(function (root) {
  'use strict';
  var reduce = false;
  try { reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { /* old browser */ }
  var hasIO = 'IntersectionObserver' in window;

  /* ---------- reveal on scroll ---------- */
  var io = hasIO && !reduce ? new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting) return;
      e.target.classList.add('in');
      countAll(e.target);
      io.unobserve(e.target);
    });
  }, { threshold: 0.08, rootMargin: '0px 0px -30px 0px' }) : null;

  function observe(scope) {
    (scope || document).querySelectorAll('.reveal:not(.in)').forEach(function (el) {
      if (io) io.observe(el); else { el.classList.add('in'); countAll(el); }
    });
  }
  /** After re-rendering content inside an already revealed block, start its counters. */
  function refresh(scope) {
    (scope || document).querySelectorAll('[data-count]').forEach(function (el) {
      var host = el.closest('.reveal');
      if (!host || host.classList.contains('in')) countUp(el);
    });
  }

  /* ---------- count-up numbers ---------- */
  function fmt(v, dec, loc) { return v.toLocaleString(loc || undefined, { minimumFractionDigits: dec, maximumFractionDigits: dec }); }
  function countAll(scope) { scope.querySelectorAll('[data-count]').forEach(countUp); }
  function countUp(el) {
    var to = parseFloat(el.getAttribute('data-count'));
    var dec = +(el.getAttribute('data-dec') || 0), pre = el.getAttribute('data-prefix') || '', suf = el.getAttribute('data-suffix') || '';
    var loc = document.documentElement.lang === 'ru' ? 'ru-RU' : 'en-US';
    el.removeAttribute('data-count');
    if (isNaN(to)) return;
    if (reduce) { el.textContent = pre + fmt(to, dec, loc) + suf; return; }
    var t0 = null, dur = 900 + Math.min(600, Math.abs(to) / 40);
    function step(ts) {
      if (t0 === null) t0 = ts;
      var k = Math.min(1, (ts - t0) / dur);
      k = 1 - Math.pow(1 - k, 3);
      el.textContent = pre + fmt(to * k, dec, loc) + suf;
      if (k < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  /* ---------- tooltip ---------- */
  var tipEl = null;
  function tipShow(text, x, y) {
    if (!tipEl) { tipEl = document.createElement('div'); tipEl.className = 'tip'; tipEl.setAttribute('role', 'tooltip'); document.body.appendChild(tipEl); }
    tipEl.textContent = text;
    tipEl.classList.add('on');
    var w = tipEl.offsetWidth, h = tipEl.offsetHeight;
    var left = Math.min(window.innerWidth - w - 8, Math.max(8, x - w / 2));
    var top = y - h - 14 < 8 ? y + 18 : y - h - 14;
    tipEl.style.transform = 'translate(' + Math.round(left) + 'px,' + Math.round(top) + 'px)';
  }
  function tipHide() { if (tipEl) tipEl.classList.remove('on'); }
  /** Attach a tooltip to an element (text can be a function). */
  function tip(el, text) {
    el.addEventListener('mousemove', function (e) { tipShow(typeof text === 'function' ? text() : text, e.clientX, e.clientY); });
    el.addEventListener('mouseleave', tipHide);
    el.addEventListener('focus', function () { var r = el.getBoundingClientRect(); tipShow(typeof text === 'function' ? text() : text, r.left + r.width / 2, r.top); });
    el.addEventListener('blur', tipHide);
  }

  /* ---------- toast ---------- */
  var toastBox = null;
  function toast(msg, kind) {
    if (!toastBox) { toastBox = document.createElement('div'); toastBox.className = 'toasts'; toastBox.setAttribute('aria-live', 'polite'); document.body.appendChild(toastBox); }
    var t = document.createElement('div');
    t.className = 'toast ' + (kind || '');
    t.textContent = msg;
    toastBox.appendChild(t);
    requestAnimationFrame(function () { t.classList.add('on'); });
    setTimeout(function () { t.classList.remove('on'); setTimeout(function () { t.remove(); }, 400); }, 3200);
  }

  /* ---------- scroll progress, header state, back-to-top, scroll-spy ---------- */
  function initChrome() {
    var bar = document.createElement('div'); bar.className = 'scroll-progress'; document.body.appendChild(bar);
    var top = document.createElement('button'); top.type = 'button'; top.className = 'to-top'; top.setAttribute('aria-label', 'Back to top');
    top.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M12 5l-7 7m7-7l7 7M12 5v14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    top.onclick = function () { window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' }); };
    document.body.appendChild(top);
    var header = document.querySelector('.bar');
    var ticking = false;
    function onScroll() {
      ticking = false;
      var h = document.documentElement, max = h.scrollHeight - h.clientHeight;
      bar.style.transform = 'scaleX(' + (max > 0 ? h.scrollTop / max : 0) + ')';
      if (header) header.classList.toggle('scrolled', h.scrollTop > 8);
      top.classList.toggle('on', h.scrollTop > 900);
    }
    window.addEventListener('scroll', function () { if (!ticking) { ticking = true; requestAnimationFrame(onScroll); } }, { passive: true });
    onScroll();
  }
  /** Highlight the link whose section is in the middle of the screen. links: NodeList of <a href="#id">. */
  function spy(links) {
    if (!hasIO) return;
    var map = {};
    links.forEach(function (a) { var id = (a.getAttribute('href') || '').slice(1); if (id) map[id] = a; });
    var obs = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        links.forEach(function (a) { a.classList.remove('active'); });
        var a = map[e.target.id]; if (a) a.classList.add('active');
      });
    }, { rootMargin: '-45% 0px -50% 0px' });
    Object.keys(map).forEach(function (id) { var s = document.getElementById(id); if (s) obs.observe(s); });
  }

  /* ---------- hero title: split words for a staggered rise ---------- */
  function splitWords(el) {
    if (!el || reduce) return;
    var words = el.textContent.trim().split(/\s+/);
    el.innerHTML = words.map(function (w, i) { return '<span class="w" style="animation-delay:' + (80 + i * 90) + 'ms">' + w.replace(/[&<>]/g, '') + '</span>'; }).join(' ');
  }

  root.FX = { observe: observe, refresh: refresh, countUp: countUp, tip: tip, tipHide: tipHide, toast: toast, initChrome: initChrome, spy: spy, splitWords: splitWords, reduce: reduce };
})(this);
