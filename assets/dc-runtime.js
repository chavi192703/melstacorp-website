/* Melstacorp prototype runtime: renders the <x-dc> page templates in any browser. */
(function () {
  'use strict';
  var HOLE = /\{\{\s*([^}]+?)\s*\}\}/g;
  var WHOLE = /^\{\{\s*([^}]+?)\s*\}\}$/;
  var comp = null, tpl = null, root = null, pending = false;

  function DCLogic(props) { this.props = props || {}; this.state = {}; }
  DCLogic.prototype.setState = function (patch) {
    if (typeof patch === 'function') patch = patch(this.state);
    Object.assign(this.state, patch || {});
    schedule();
  };
  window.DCLogic = DCLogic;

  function schedule() {
    if (pending) return;
    pending = true;
    (window.requestAnimationFrame || setTimeout)(function () { pending = false; render(); });
  }

  function lookup(expr, scope) {
    expr = expr.trim();
    if (expr === 'true') return true;
    if (expr === 'false') return false;
    if (/^-?\d+(\.\d+)?$/.test(expr)) return parseFloat(expr);
    var parts = expr.split('.');
    for (var i = scope.length - 1; i >= 0; i--) {
      var frame = scope[i];
      if (frame && Object.prototype.hasOwnProperty.call(frame, parts[0])) {
        var v = frame;
        for (var j = 0; j < parts.length; j++) { if (v == null) return undefined; v = v[parts[j]]; }
        return v;
      }
    }
    return undefined;
  }
  function interp(str, scope) {
    return str.replace(HOLE, function (_, e) { var v = lookup(e, scope); return v == null ? '' : String(v); });
  }

  function build(node, scope, out) {
    if (node.nodeType === 3) { out.push(document.createTextNode(interp(node.data, scope))); return; }
    if (node.nodeType !== 1) return;
    var tag = node.localName;
    if (tag === 'helmet') return;
    if (tag === 'sc-for') {
      var list = lookup((node.getAttribute('list') || '').replace(/[{}]/g, ''), scope) || [];
      var as = node.getAttribute('as') || 'item';
      for (var k = 0; k < list.length; k++) {
        var f = {}; f[as] = list[k];
        var s2 = scope.concat([f]);
        for (var c = node.firstChild; c; c = c.nextSibling) build(c, s2, out);
      }
      return;
    }
    if (tag === 'sc-if') {
      if (lookup((node.getAttribute('value') || '').replace(/[{}]/g, ''), scope)) {
        for (var c2 = node.firstChild; c2; c2 = c2.nextSibling) build(c2, scope, out);
      }
      return;
    }
    var el = node.namespaceURI && node.namespaceURI !== 'http://www.w3.org/1999/xhtml'
      ? document.createElementNS(node.namespaceURI, node.localName) : document.createElement(tag);
    el.__dch = {};
    for (var a = 0; a < node.attributes.length; a++) {
      var at = node.attributes[a], name = at.name, val = at.value;
      if (name.indexOf('hint-') === 0) continue;
      if (name.indexOf('dc-') === 0) name = name.slice(3);
      var m = WHOLE.exec(val);
      if (name.length > 2 && name.slice(0, 2) === 'on' && m) {
        var fn = lookup(m[1], scope);
        if (typeof fn === 'function') el.__dch[name.slice(2).toLowerCase()] = fn;
        continue;
      }
      try { el.setAttribute(name, interp(val, scope)); } catch (e) { /* invalid attr name */ }
    }
    var kids = [];
    for (var c3 = node.firstChild; c3; c3 = c3.nextSibling) build(c3, scope, kids);
    for (var q = 0; q < kids.length; q++) el.appendChild(kids[q]);
    out.push(el);
  }

  function bindEvents(el, handlers) {
    el.__dcur = handlers;
    el.__dbound = el.__dbound || {};
    Object.keys(handlers).forEach(function (type) {
      if (el.__dbound[type]) return;
      el.__dbound[type] = true;
      el.addEventListener(type, function (e) { var h = el.__dcur && el.__dcur[type]; if (h) h(e); });
    });
  }

  function patchAttrs(oldEl, newEl) {
    var i, at;
    for (i = oldEl.attributes.length - 1; i >= 0; i--) {
      at = oldEl.attributes[i];
      if (!newEl.hasAttribute(at.name)) oldEl.removeAttribute(at.name);
    }
    for (i = 0; i < newEl.attributes.length; i++) {
      at = newEl.attributes[i];
      if (oldEl.getAttribute(at.name) !== at.value) oldEl.setAttribute(at.name, at.value);
    }
    if ((oldEl.localName === 'input' || oldEl.localName === 'textarea') && newEl.hasAttribute('value')) {
      var nv = newEl.getAttribute('value');
      if (oldEl.value !== nv && (document.activeElement !== oldEl || nv === '')) oldEl.value = nv;
    }
  }

  function morph(parent, nodes) {
    var i = 0, old = parent.firstChild;
    for (; i < nodes.length; i++) {
      var n = nodes[i];
      if (old && old.nodeType === n.nodeType && old.nodeName === n.nodeName && old.namespaceURI === n.namespaceURI) {
        if (n.nodeType === 3) { if (old.data !== n.data) old.data = n.data; }
        else {
          patchAttrs(old, n);
          bindEvents(old, n.__dch || {});
          morph(old, Array.prototype.slice.call(n.childNodes));
        }
        old = old.nextSibling;
      } else {
        if (n.nodeType === 1) bindTree(n);
        parent.insertBefore(n, old);
        if (n.nodeType === 1) { var af = n.hasAttribute('autofocus') ? n : n.querySelector('[autofocus]'); if (af) setTimeout(function () { af.focus(); }, 30); }
      }
    }
    while (old) { var nx = old.nextSibling; parent.removeChild(old); old = nx; }
  }
  function bindTree(el) {
    if (el.__dch) bindEvents(el, el.__dch);
    for (var c = el.firstElementChild; c; c = c.nextElementSibling) bindTree(c);
  }

  function render() {
    var vals = comp.renderVals() || {};
    var out = [];
    for (var c = tpl.firstChild; c; c = c.nextSibling) build(c, [vals], out);
    morph(root, out);
  }

  function boot() {
    var src = document.querySelector('script[type="text/x-dc"]');
    var xdc = document.querySelector('x-dc');
    if (!src || !xdc) return;
    var props = {};
    try {
      var decl = JSON.parse(src.getAttribute('data-props') || '{}');
      Object.keys(decl).forEach(function (k) { if (k.charAt(0) !== '$' && decl[k] && 'default' in decl[k]) props[k] = decl[k]['default']; });
    } catch (e) { /* no props */ }
    var helmet = xdc.querySelector('helmet');
    if (helmet) { while (helmet.firstChild) document.head.appendChild(helmet.firstChild); helmet.parentNode.removeChild(helmet); }
    var Klass = new Function('DCLogic', src.textContent + '\nreturn Component;')(DCLogic);
    comp = new Klass(props);
    if (!comp.state) comp.state = {};
    tpl = xdc;
    root = document.createElement('div');
    root.id = 'dc-root';
    root.style.display = 'contents';
    xdc.parentNode.insertBefore(root, xdc);
    xdc.parentNode.removeChild(xdc);
    render();
    if (location.hash) { var t = document.getElementById(location.hash.slice(1)); if (t) setTimeout(function () { t.scrollIntoView(); }, 50); }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
