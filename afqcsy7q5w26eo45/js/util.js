/* Мелкие утилиты: DOM, экранирование, состояние в hash-URL. */
'use strict';

var U = (function () {

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v == null || v === false) return;
        if (k === 'class') node.className = v;
        else if (k === 'html') node.innerHTML = v;
        else if (k === 'text') node.textContent = v;
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), v);
        else node.setAttribute(k, v === true ? '' : v);
      });
    }
    (children || []).forEach(function (c) {
      if (c == null) return;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return node;
  }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); return node; }

  /* ------------------------------------------------------------- hash-URL */

  // #/events?cp=X&sys=a,b  ->  { path: ['events'], params: {cp:'X', sys:'a,b'} }
  function parseHash() {
    var h = location.hash.replace(/^#/, '');
    if (!h) h = '/issues';
    var qi = h.indexOf('?');
    var pathStr = qi < 0 ? h : h.slice(0, qi);
    var params = {};
    if (qi >= 0) {
      new URLSearchParams(h.slice(qi + 1)).forEach(function (v, k) { params[k] = v; });
    }
    var path = pathStr.split('/').filter(Boolean).map(decodeURIComponent);
    return { path: path, params: params };
  }

  function buildHash(path, params) {
    var s = '#/' + path.map(encodeURIComponent).join('/');
    var q = new URLSearchParams();
    Object.keys(params || {}).forEach(function (k) {
      var v = params[k];
      if (v == null || v === '') return;
      q.set(k, v);
    });
    var qs = q.toString();
    return qs ? s + '?' + qs : s;
  }

  // Меняет параметры текущего маршрута, не перезапуская роутер (для выбора строк).
  function setParams(patch, opts) {
    var cur = parseHash();
    Object.keys(patch).forEach(function (k) {
      var v = patch[k];
      if (v == null || v === '') delete cur.params[k];
      else cur.params[k] = String(v);
    });
    var url = buildHash(cur.path, cur.params);
    if (opts && opts.push) location.hash = url;
    else history.replaceState(null, '', url);
    return cur.params;
  }

  function go(path, params) { location.hash = buildHash(path, params); }

  /* ---------------------------------------------------------------- прочее */

  function list(v) { return v == null || v === '' ? [] : String(v).split(',').map(function (s) { return s.trim(); }).filter(Boolean); }

  function toggleIn(arr, v) {
    var i = arr.indexOf(v);
    if (i < 0) arr.push(v); else arr.splice(i, 1);
    return arr;
  }

  function sqlLit(v) {
    if (v == null) return 'NULL';
    if (typeof v === 'number') return String(v);
    return "'" + String(v).replace(/'/g, "''") + "'";
  }

  function sqlIn(values) { return values.map(sqlLit).join(', '); }

  // Ключ строки для URL: значение первичной колонки + номер повтора, если оно не уникально.
  function rowKey(rows, index, columns) {
    var key = columns[0];
    var val = rows[index][key];
    var s = val == null ? '∅' : String(val);
    var n = 0;
    for (var i = 0; i < index; i++) {
      var iv = rows[i][key];
      if ((iv == null ? '∅' : String(iv)) === s) n++;
    }
    return n ? s + '~' + n : s;
  }

  function findRowByKey(rows, columns, key) {
    if (key == null || !rows.length) return -1;
    var m = /^(.*)~(\d+)$/.exec(key);
    var want = m ? m[1] : key;
    var nth = m ? parseInt(m[2], 10) : 0;
    var col = columns[0], n = 0;
    for (var i = 0; i < rows.length; i++) {
      var v = rows[i][col];
      if ((v == null ? '∅' : String(v)) === want) {
        if (n === nth) return i;
        n++;
      }
    }
    return -1;
  }

  function debounce(fn, ms) {
    var t;
    return function () {
      var a = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, a); }, ms);
    };
  }

  function isDark() { return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches; }

  return {
    esc: esc, el: el, clear: clear,
    parseHash: parseHash, buildHash: buildHash, setParams: setParams, go: go,
    list: list, toggleIn: toggleIn, sqlLit: sqlLit, sqlIn: sqlIn,
    rowKey: rowKey, findRowByKey: findRowByKey, debounce: debounce, isDark: isDark
  };
})();
