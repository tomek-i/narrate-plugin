/**
 * Browser-side overlay toolkit, injected via `addInitScript` so it survives
 * navigations. It draws a synthetic cursor and element highlights *into the page*
 * (captured by the video recorder), inside a `position:fixed`, `pointer-events:none`
 * container so it never steals input or blocks the real Playwright interactions —
 * and never touches the user's OS cursor. Exposes `window.__narrate`.
 *
 * Accent color is read from `window.__NARRATE_COLOR` (set by a tiny init script).
 *
 * This string runs in the browser — keep it dependency-free, plain DOM JS.
 */
export const OVERLAY_SCRIPT = String.raw`
(() => {
  if (window.__narrate) return;
  var Z = 2147483600;
  var NS = {};
  var root, layer, cursor, started = false;
  var highlights = new Map(); // selector -> { box, label, style }

  function color() { return window.__NARRATE_COLOR || '#6366f1'; }

  function ensure() {
    if (root && document.documentElement.contains(root)) return;
    root = document.createElement('div');
    root.id = '__narrate_overlay';
    root.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:' + Z + ';';
    layer = document.createElement('div');
    layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:1;';
    cursor = document.createElement('div');
    cursor.style.cssText =
      'position:fixed;left:0;top:0;width:22px;height:22px;z-index:3;pointer-events:none;opacity:0;' +
      'transform:translate(-9999px,-9999px);will-change:transform;' +
      'transition:transform .45s cubic-bezier(.22,.61,.36,1),opacity .2s;' +
      'filter:drop-shadow(0 1px 2px rgba(0,0,0,.45));';
    cursor.innerHTML =
      '<svg width="22" height="22" viewBox="0 0 24 24" fill="#fff" stroke="#000" stroke-width="1.2">' +
      '<path d="M5 3l14 7-6 1.6L9.5 18 5 3z"/></svg>';
    root.appendChild(layer);
    root.appendChild(cursor);
    (document.body || document.documentElement).appendChild(root);

    if (!document.getElementById('__narrate_style')) {
      var s = document.createElement('style');
      s.id = '__narrate_style';
      s.textContent =
        '@keyframes __narrate_pulse{0%,100%{opacity:1}50%{opacity:.4}}' +
        '@keyframes __narrate_ripple{0%{transform:translate(-50%,-50%) scale(.25);opacity:.55}' +
        '100%{transform:translate(-50%,-50%) scale(1.5);opacity:0}}';
      (document.head || document.documentElement).appendChild(s);
    }
    if (!started) { started = true; requestAnimationFrame(tick); }
  }

  function rectOf(sel) {
    var el = document.querySelector(sel);
    return el ? { el: el, r: el.getBoundingClientRect() } : null;
  }

  function tick() {
    highlights.forEach(function (h, sel) {
      var el = document.querySelector(sel);
      if (!el) { h.box.style.opacity = '0'; if (h.label) h.label.style.opacity = '0'; return; }
      var r = el.getBoundingClientRect();
      var pad = h.style === 'spotlight' ? 0 : 6;
      h.box.style.left = (r.left - pad) + 'px';
      h.box.style.top = (r.top - pad) + 'px';
      h.box.style.width = (r.width + pad * 2) + 'px';
      h.box.style.height = (r.height + pad * 2) + 'px';
      h.box.style.opacity = '1';
      if (h.label) {
        h.label.style.left = r.left + 'px';
        h.label.style.top = Math.max(4, r.top - 30) + 'px';
        h.label.style.opacity = '1';
      }
    });
    requestAnimationFrame(tick);
  }

  function makeBox(style, c) {
    var box = document.createElement('div');
    var css = 'position:fixed;pointer-events:none;border-radius:10px;box-sizing:border-box;' +
      'opacity:0;transition:left .25s ease,top .25s ease,width .25s ease,height .25s ease,opacity .2s;';
    if (style === 'glow') {
      css += 'box-shadow:0 0 0 3px ' + c + 'cc,0 0 26px 8px ' + c + '99;';
    } else if (style === 'spotlight') {
      css += 'box-shadow:0 0 0 4px ' + c + ',0 0 0 9999px rgba(0,0,0,.55);' +
        'animation:__narrate_pulse 2.2s ease-in-out infinite;';
    } else { // ring
      css += 'border:3px solid ' + c + ';box-shadow:0 0 14px ' + c + '88;' +
        'animation:__narrate_pulse 1.6s ease-in-out infinite;';
    }
    box.style.cssText = css;
    return box;
  }

  NS.pointAt = function (sel, dur) {
    ensure();
    var hit = rectOf(sel);
    if (!hit) return false;
    var r = hit.r;
    var x = r.left + Math.min(r.width / 2, 12);
    var y = r.top + Math.min(r.height / 2, 12);
    cursor.style.transition = 'transform ' + (dur || 450) + 'ms cubic-bezier(.22,.61,.36,1),opacity .2s';
    cursor.style.opacity = '1';
    cursor.style.transform = 'translate(' + x + 'px,' + y + 'px)';
    NS._pos = { x: x, y: y };
    return true;
  };

  NS.ripple = function (sel) {
    ensure();
    var x, y;
    if (sel) { var hit = rectOf(sel); if (hit) { x = hit.r.left + Math.min(hit.r.width / 2, 12); y = hit.r.top + Math.min(hit.r.height / 2, 12); } }
    if (x == null && NS._pos) { x = NS._pos.x; y = NS._pos.y; }
    if (x == null) return;
    var d = document.createElement('div');
    d.style.cssText = 'position:fixed;left:' + x + 'px;top:' + y + 'px;width:38px;height:38px;' +
      'border-radius:50%;background:' + color() + ';opacity:.5;pointer-events:none;z-index:2;' +
      'animation:__narrate_ripple .5s ease-out forwards;';
    layer.appendChild(d);
    setTimeout(function () { d.remove(); }, 520);
  };

  // Fade an entry out (so the page returns to normal) instead of a hard cut.
  function fadeOut(h) {
    if (h.timer) { clearTimeout(h.timer); h.timer = null; }
    var els = [h.box]; if (h.label) els.push(h.label);
    els.forEach(function (e) { e.style.transition = 'opacity .3s ease'; e.style.opacity = '0'; });
    setTimeout(function () { els.forEach(function (e) { e.remove(); }); }, 320);
  }

  NS.highlight = function (sel, opts) {
    ensure();
    opts = opts || {};
    var style = opts.style || 'ring';
    var hold = opts.hold == null ? 0 : opts.hold; // engine passes the configured value
    var c = color();
    var prev = highlights.get(sel);
    if (prev) { highlights.delete(sel); fadeOut(prev); }
    var box = makeBox(style, c);
    layer.appendChild(box);
    var label = null;
    if (opts.label) {
      label = document.createElement('div');
      label.textContent = opts.label;
      label.style.cssText = 'position:fixed;pointer-events:none;z-index:4;background:' + c + ';color:#fff;' +
        'font:600 13px/1.4 system-ui,-apple-system,sans-serif;padding:4px 10px;border-radius:6px;' +
        'white-space:nowrap;opacity:0;box-shadow:0 2px 8px rgba(0,0,0,.3);transition:left .25s ease,top .25s ease,opacity .2s;';
      layer.appendChild(label);
    }
    var entry = { box: box, label: label, style: style, timer: null };
    // Auto-fade after hold ms so a highlight is a brief pulse, not a full-beat
    // overlay that obscures the page and confuses real vs. animated content.
    if (hold > 0) entry.timer = setTimeout(function () { NS.unhighlight(sel); }, hold);
    highlights.set(sel, entry);
    return true;
  };

  NS.unhighlight = function (sel) {
    if (sel) {
      var h = highlights.get(sel);
      if (h) { highlights.delete(sel); fadeOut(h); }
    } else {
      highlights.forEach(function (h, k) { highlights.delete(k); fadeOut(h); });
    }
  };

  window.__narrate = NS;
})();
`;
