/* Tiny dependency-free SVG charts (bars + lines, optional right axis). */
(function (root) {
  'use strict';
  var NS = 'http://www.w3.org/2000/svg';

  function el(tag, attrs, parent) {
    var e = document.createElementNS(NS, tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }

  function niceRange(min, max, zero) {
    if (zero) { min = Math.min(0, min); max = Math.max(0, max); }
    if (min === max) { max = min + 1; }
    var span = max - min;
    var step = Math.pow(10, Math.floor(Math.log10(span / 4)));
    var err = span / 4 / step;
    if (err >= 5) step *= 5; else if (err >= 2) step *= 2;
    return { min: Math.floor(min / step) * step, max: Math.ceil(max / step) * step, step: step };
  }

  function fmtNum(v) {
    var a = Math.abs(v);
    if (a >= 1000) return (v / 1000).toFixed(a >= 10000 ? 0 : 1) + 'k';
    if (a >= 10 || v === 0) return Math.round(v).toString();
    return v.toFixed(1);
  }

  /**
   * opts: { x: [labels], series: [{type:'bar'|'line', name, values, color, axis:'left'|'right', dash, title(i)}],
   *         height, unitLeft, unitRight, zero }
   */
  function chart(container, opts) {
    container.innerHTML = '';
    var W = 820, H = opts.height || 240;
    var m = { l: 46, r: opts.series.some(function (s) { return s.axis === 'right'; }) ? 46 : 12, t: 12, b: 26 };
    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'chart', role: 'img', 'aria-label': opts.label || '' }, container);
    var n = opts.x.length;
    var pw = W - m.l - m.r, ph = H - m.t - m.b;
    function rangeFor(axis) {
      var vals = [];
      opts.series.forEach(function (s) { if ((s.axis || 'left') === axis) s.values.forEach(function (v) { if (v !== null && !isNaN(v)) vals.push(v); }); });
      if (!vals.length) return null;
      return niceRange(Math.min.apply(null, vals), Math.max.apply(null, vals), opts.zero !== false);
    }
    var rl = rangeFor('left'), rr = rangeFor('right');
    function yl(v, r) { return m.t + ph - (v - r.min) / (r.max - r.min) * ph; }
    var band = pw / n;
    function xc(i) { return m.l + band * (i + 0.5); }
    // grid + left axis
    var g = el('g', { class: 'axis' }, svg);
    if (rl) {
      for (var v = rl.min; v <= rl.max + 1e-9; v += rl.step) {
        var y = yl(v, rl);
        el('line', { x1: m.l, x2: W - m.r, y1: y, y2: y, class: Math.abs(v) < 1e-9 ? 'zero' : 'grid' }, g);
        var tx = el('text', { x: m.l - 6, y: y + 4, 'text-anchor': 'end' }, g); tx.textContent = fmtNum(v);
      }
    }
    if (rr) {
      for (var v2 = rr.min; v2 <= rr.max + 1e-9; v2 += rr.step) {
        var tt = el('text', { x: W - m.r + 6, y: yl(v2, rr) + 4, 'text-anchor': 'start', class: 'right' }, g); tt.textContent = fmtNum(v2);
      }
    }
    // x labels: every k-th
    var every = Math.ceil(n / 12);
    opts.x.forEach(function (lab, i) {
      if (i % every) return;
      var t = el('text', { x: xc(i), y: H - 8, 'text-anchor': 'middle' }, g); t.textContent = lab;
    });
    // series
    var bars = opts.series.filter(function (s) { return s.type === 'bar'; });
    var bw = band * 0.8 / Math.max(1, bars.length);
    bars.forEach(function (s, bi) {
      var r = s.axis === 'right' ? rr : rl;
      s.values.forEach(function (val, i) {
        if (val === null || isNaN(val)) return;
        var y0 = yl(Math.max(r.min, Math.min(r.max, 0)), r), y1 = yl(val, r);
        var rect = el('rect', {
          x: m.l + band * i + band * 0.1 + bw * bi, y: Math.min(y0, y1), width: Math.max(1, bw - 1), height: Math.max(0.5, Math.abs(y1 - y0)),
          fill: typeof s.color === 'function' ? s.color(val, i) : s.color, rx: 1.5
        }, svg);
        var ti = el('title', {}, rect); ti.textContent = (s.title ? s.title(i) : opts.x[i] + ': ' + fmtNum(val));
      });
    });
    opts.series.filter(function (s) { return s.type === 'line'; }).forEach(function (s) {
      var r = s.axis === 'right' ? rr : rl;
      var d = '';
      s.values.forEach(function (val, i) {
        if (val === null || isNaN(val)) return;
        d += (d ? 'L' : 'M') + xc(i).toFixed(1) + ',' + yl(val, r).toFixed(1);
      });
      el('path', { d: d, fill: 'none', stroke: s.color, 'stroke-width': s.width || 2.2, 'stroke-dasharray': s.dash || '', 'stroke-linejoin': 'round' }, svg);
      if (s.dots !== false) {
        s.values.forEach(function (val, i) {
          if (val === null || isNaN(val)) return;
          var c = el('circle', { cx: xc(i), cy: yl(val, r), r: 2.6, fill: s.color }, svg);
          var ti = el('title', {}, c); ti.textContent = (s.title ? s.title(i) : s.name + ', ' + opts.x[i] + ': ' + fmtNum(val));
        });
      }
    });
    // legend
    if (opts.legend !== false) {
      var lg = document.createElement('div');
      lg.className = 'legend';
      opts.series.forEach(function (s) {
        if (!s.name) return;
        var it = document.createElement('span');
        var sw = document.createElement('i');
        sw.style.background = typeof s.color === 'function' ? s.legendColor || '#999' : s.color;
        if (s.type === 'line') sw.className = 'line';
        it.appendChild(sw);
        it.appendChild(document.createTextNode(s.name + (s.axis === 'right' && opts.unitRight ? ' (' + opts.unitRight + ' →)' : '')));
        lg.appendChild(it);
      });
      container.appendChild(lg);
    }
    return svg;
  }

  root.Charts = { chart: chart, fmtNum: fmtNum };
})(this);
