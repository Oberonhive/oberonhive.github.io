/* Словарь render из report-conventions.md: как показывать значение колонки.
   Любая трансформация здесь только визуальная — значение для сортировки,
   фильтра и экспорта остаётся исходным. */
'use strict';

var Render = (function () {

  var SYSTEMS = ['posthog', 'gtm_datalayer', 'firebase_web', 'native_firebase', 'native_facebook',
    'appsflyer', 'customerio', 'gleam', 'hotjar', 'sentry', 'posthog_android',
    'native_auth_bridge', 'native_legacy', 'intercom'];

  var ROLE_ICON = { view: '👁', action: '✋', success: '✅', error: '⛔', identity: '🪪' };

  function vendorVar(v) {
    var s = String(v || '').toLowerCase();
    if (s.indexOf('ga4') >= 0 || s.indexOf('google tag') >= 0 || s.indexOf('google conversion') >= 0) return '--v-ga4';
    if (s.indexOf('meta') >= 0 || s.indexOf('facebook') >= 0) return '--v-meta';
    if (s.indexOf('tiktok') >= 0) return '--v-tiktok';
    if (s.indexOf('linkedin') >= 0) return '--v-linkedin';
    if (s.indexOf('reddit') >= 0) return '--v-reddit';
    return '--v-other';
  }

  function dash() { return '<span class="dash">—</span>'; }

  function isEmpty(v) { return v == null || v === ''; }

  /* -------------------------------------------------------------- рендеры */

  var R = {
    code: function (v) {
      return isEmpty(v) ? dash() : '<span class="mono">' + U.esc(v) + '</span>';
    },
    expr: function (v) {
      return isEmpty(v) ? dash() : '<span class="mono wrap">' + U.esc(v) + '</span>';
    },
    name: function (v) {
      return isEmpty(v) ? dash() : '<span class="mono-b">' + U.esc(v) + '</span>';
    },
    names: function (v) {
      if (isEmpty(v)) return dash();
      return String(v).split(',').map(function (s) { return s.trim(); })
        .filter(Boolean)
        .map(function (s) { return '<span class="chipv">' + U.esc(s) + '</span>'; }).join('');
    },
    system: function (v) {
      if (isEmpty(v)) return dash();
      var id = String(v);
      var known = SYSTEMS.indexOf(id) >= 0;
      var cls = 'badge badge-sys' + (id === 'posthog_android' ? ' badge-dashed' : '');
      var color = known ? 'var(--sys-' + id + ')' : 'var(--sys-sentry)';
      return '<span class="' + cls + '" style="--c:' + color + '">' + U.esc(id) + '</span>';
    },
    vendor: function (v) {
      if (isEmpty(v)) return dash();
      return '<span class="badge badge-sys" style="--c:var(' + vendorVar(v) + ')">' + U.esc(v) + '</span>';
    },
    bool: function (v) {
      if (v == null || v === '') return '<span class="dash" title="неизвестно">?</span>';
      var n = Number(v);
      return n ? '<span style="color:var(--ok)">✓</span>' : '<span class="dash">—</span>';
    },
    literals: function (v) {
      if (isEmpty(v)) return dash();
      var arr;
      try { arr = JSON.parse(v); } catch (e) { arr = String(v).split(','); }
      if (!Array.isArray(arr)) arr = [arr];
      return arr.map(function (s) { return '<span class="chipv">' + U.esc(s) + '</span>'; }).join('');
    },
    pii: function (v) {
      if (isEmpty(v) || v === 'none') return '';
      var id = String(v);
      return '<span class="badge badge-sys" style="--c:var(--pii-' + id + ', var(--pii-pseudo_id))">'
        + U.esc(id) + '</span>';
    },
    stage: function (v) {
      if (isEmpty(v)) return dash();
      return String(v).split(',').map(function (s) { return s.trim(); }).filter(Boolean)
        .map(function (s) { return '<span class="badge badge-stage">' + U.esc(s) + '</span>'; }).join(' ');
    },
    role: function (v) {
      if (isEmpty(v)) return dash();
      var ic = ROLE_ICON[v] || '·';
      return '<span title="' + U.esc(v) + '">' + ic + ' <span class="mono">' + U.esc(v) + '</span></span>';
    },
    count: function (v) {
      if (isEmpty(v)) return dash();
      return '<span class="mono">' + U.esc(v) + '</span>';
    },
    long: function (v) {
      return isEmpty(v) ? dash() : '<span class="wrap">' + U.esc(v) + '</span>';
    },
    chunk: function (v, row) {
      if (isEmpty(v)) return dash();
      var label = row && row.chunk_label ? row.chunk_label : v;
      var file = row && row.chunk_label ? v : '';
      return '<span class="mono" title="' + U.esc(file || v) + '">' + U.esc(label) + '</span>';
    },
    text: function (v) { return isEmpty(v) ? dash() : U.esc(v); }
  };

  /* ------------------------------------------------- вывод render по имени */

  function infer(col) {
    if (!col) return 'text';
    // Колонки-системы в v_journey / v_matrix: в ячейке имя события в этой системе,
    // иногда несколько через запятую — показываем чипами.
    if (isSystemColumn(col)) return 'names';
    if (col === 'system_id' || col === 'systems_list') return 'system';
    if (col === 'vendor') return 'vendor';
    if (col === 'stage' || col === 'stages') return 'stage';
    if (col === 'role') return 'role';
    if (col === 'pii_class') return 'pii';
    if (col === 'value_literals') return 'literals';
    if (col === 'chunk') return 'chunk';
    if (/^(gtm_tagged|paused|event_sends_it|in_apk|name_is_dynamic)$/.test(col)) return 'bool';
    if (/^(notes|note|hint|gating|description|question|targeting|buckets|details|signature)$/.test(col)) return 'long';
    if (/(_expr|_exprs)$/.test(col) || /^(condition|sql|payload|params|arg_expr)$/.test(col)) return 'expr';
    if (/^(event_name|name|param|source_event|vendor_event|reads_variable)$/.test(col)) return 'name';
    if (/_names$|^names$|^points$|^components$|^used_in_chunks$|^systems_names$/.test(col)) return 'names';
    if (/^(systems|events|distinct_names|call_points|event_names|occurrences|count|n|cnt|sites|points_n|tags)$/.test(col)) return 'count';
    if (/_id$/.test(col)) return 'code';
    return 'text';
  }

  function get(name) { return R[name] || R.text; }

  // Колонки v_journey / v_matrix, где значение — имя события в системе.
  function isSystemColumn(col) { return SYSTEMS.indexOf(col) >= 0 || col === 'dataLayer'; }

  function systemOfColumn(col) { return col === 'dataLayer' ? 'gtm_datalayer' : col; }
  function systemColor(id) { return SYSTEMS.indexOf(String(id)) >= 0 ? 'var(--sys-' + id + ')' : 'var(--sys-sentry)'; }

  /* ------------------------------------------------------ мелкие помощники */

  function badge(text, cls, colorVar) {
    return '<span class="badge ' + (cls || 'badge-plain') + '"'
      + (colorVar ? ' style="--c:var(' + colorVar + ')"' : '') + '>' + U.esc(text) + '</span>';
  }

  function severityBadge(sev) {
    var v = Number(sev) || 0;
    var color = v >= 9 ? '--alert' : v >= 7 ? '--warn' : v >= 5 ? '--sys-sentry' : '--sys-sentry';
    return '<span class="badge badge-sev" style="--c:var(' + color + ')" title="severity '
      + v + '/10 по шкале report-conventions.md">' + v + '/10</span>';
  }

  function highlight(text, needles) {
    var out = U.esc(text == null ? '' : text);
    (needles || []).forEach(function (n) {
      var esc = U.esc(n).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      out = out.replace(new RegExp(esc, 'g'), '<mark>' + U.esc(n) + '</mark>');
    });
    return '<span class="wrap">' + out + '</span>';
  }

  return {
    R: R, get: get, infer: infer, badge: badge, severityBadge: severityBadge,
    isSystemColumn: isSystemColumn, systemOfColumn: systemOfColumn, systemColor: systemColor,
    highlight: highlight, dash: dash, SYSTEMS: SYSTEMS, vendorVar: vendorVar
  };
})();
