/* Навигатор Events: точки вызова → события → параметры + режим «Матрица».

   Мастер-детали обновляются на месте: выбор строки меняет параметры URL через
   history.replaceState (без hashchange) и перерисовывает только зависимую область.
   Полная перерисовка маршрута — только при смене фильтров (U.go → hashchange). */
'use strict';

var Events = (function () {

  var CP_HINT = 'Место в коде, которое отправляет события. Одна точка = одно действие пользователя; '
    + 'по ней матчатся события разных систем';
  var EV_HINT = 'Одна строка — отправка в одну систему. Разные имена в разных системах — норма для этого кода';
  var PA_HINT = 'Параметры всех событий точки вызова: одна строка — поле одного события в одной системе, '
    + 'строки сгруппированы по имени поля, чтобы сравнить состав между системами. '
    + 'value_expr — выражение из кода; added_by = transport — поле добавляет транспорт, а не точка вызова';
  var PV_HINT = 'Сравнение: строка — имя поля, колонка — событие (система · имя), ячейка — выражение-значение; '
    + 'пусто = событие не несёт это поле';

  var LABELS = {
    sys: 'система', stage: 'стадия', layer: 'слой', product: 'продукт', kind: 'kind',
    cp: 'точка вызова', ev: 'событие'
  };

  /* ---------------------------------------------------------- фильтр-панель */

  function filterBar(host, p, rerender) {
    var bar = U.el('div', { class: 'chipbar' });

    function chipGroup(label, values, key, chipAttrs) {
      var picked = U.list(p[key]);
      bar.appendChild(U.el('span', { class: 'chipbar-label', text: label }));
      values.forEach(function (v) {
        var on = picked.indexOf(String(v)) >= 0;
        var attrs = { class: 'chip' + (on ? ' on' : ''), text: String(v) };
        if (chipAttrs) {
          var extra = chipAttrs(v);
          Object.keys(extra).forEach(function (k) { attrs[k] = k === 'class' ? attrs.class + ' ' + extra[k] : extra[k]; });
        }
        var c = U.el('span', attrs);
        c.addEventListener('click', function () {
          var patch = {};
          patch[key] = U.toggleIn(U.list(p[key]), String(v)).join(',');
          rerender(patch);
        });
        bar.appendChild(c);
      });
    }

    var systems = DB.values("SELECT system_id FROM system WHERE system_id IN (SELECT DISTINCT system_id FROM event) ORDER BY system_id");
    // цвет системы — на самом чипе, без вложенного бейджа
    chipGroup('система', systems, 'sys', function (v) {
      return { class: 'chip-sys', style: '--c:' + Render.systemColor(v) };
    });

    var stages = DB.values('SELECT DISTINCT stage FROM journey_step ORDER BY stage_no');
    chipGroup('стадия', stages, 'stage');

    var bar2 = U.el('div', { class: 'chipbar' });
    function select(label, values, key) {
      bar2.appendChild(U.el('span', { class: 'chipbar-label', text: label }));
      var s = U.el('select', { class: 'selopt' });
      s.appendChild(U.el('option', { value: '', text: 'все' }));
      values.forEach(function (v) {
        var o = U.el('option', { value: v, text: v });
        if (String(p[key] || '') === String(v)) o.selected = true;
        s.appendChild(o);
      });
      s.addEventListener('change', function () {
        var patch = {};
        patch[key] = s.value;
        rerender(patch);
      });
      bar2.appendChild(s);
    }
    select('слой', DB.values('SELECT DISTINCT layer FROM call_point WHERE layer IS NOT NULL ORDER BY 1'), 'layer');
    select('продукт', DB.values('SELECT DISTINCT product FROM call_point WHERE product IS NOT NULL ORDER BY 1'), 'product');
    select('kind', DB.values('SELECT DISTINCT kind FROM event ORDER BY 1'), 'kind');

    var hide = p.tr !== '0';
    var tg = U.el('label', { class: 'toggle' }, [
      U.el('input', { type: 'checkbox', checked: hide }),
      U.el('span', { text: 'скрыть транспортные поля' })
    ]);
    tg.firstChild.addEventListener('change', function () { rerender({ tr: hide ? '0' : '' }); });
    bar2.appendChild(tg);

    var modeBtn = U.el('button', { class: 'btn' + (p.mode === 'matrix' ? ' btn-primary' : ''), text: 'Матрица' });
    modeBtn.addEventListener('click', function () { rerender({ mode: p.mode === 'matrix' ? '' : 'matrix' }); });
    bar2.appendChild(modeBtn);

    host.appendChild(bar);
    host.appendChild(bar2);
  }

  // Активные фильтры и выбор — отдельной строкой, снимаются по одному.
  // Перерисовывается на месте после каждого выбора (chipsHost остаётся в DOM).
  function activeChips(chipsHost, p, rerender, labels) {
    U.clear(chipsHost);
    var keys = Object.keys(labels).filter(function (k) { return p[k]; });
    if (!keys.length) return;
    var bar = U.el('div', { class: 'chipbar' }, [U.el('span', { class: 'chipbar-label', text: 'активно' })]);
    keys.forEach(function (k) {
      var c = U.el('span', {
        class: 'chip filter-active',
        html: U.esc(labels[k]) + ': ' + U.esc(p[k]) + ' <span class="x">×</span>',
        title: 'снять'
      });
      c.addEventListener('click', function () {
        var patch = {};
        patch[k] = '';
        if (k === 'cp') patch.ev = '';
        rerender(patch);
      });
      bar.appendChild(c);
    });
    var all = U.el('span', { class: 'chip', text: 'снять все' });
    all.addEventListener('click', function () {
      var patch = {};
      Object.keys(labels).forEach(function (k) { patch[k] = ''; });
      rerender(patch);
    });
    bar.appendChild(all);
    chipsHost.appendChild(bar);
  }

  /* ------------------------------------------------------------------ SQL */

  function callPointsSql(p) {
    var w = [];
    var sys = U.list(p.sys), stage = U.list(p.stage);
    if (sys.length) {
      w.push('EXISTS (SELECT 1 FROM event e WHERE e.call_point_id = cp.call_point_id AND e.system_id IN ('
        + U.sqlIn(sys) + '))');
    }
    if (stage.length) {
      w.push('EXISTS (SELECT 1 FROM journey_step j WHERE j.call_point_id = cp.call_point_id AND j.stage IN ('
        + U.sqlIn(stage) + '))');
    }
    if (p.layer) w.push('cp.layer = ' + U.sqlLit(p.layer));
    if (p.product) w.push('cp.product = ' + U.sqlLit(p.product));
    if (p.kind) {
      w.push('EXISTS (SELECT 1 FROM event e WHERE e.call_point_id = cp.call_point_id AND e.kind = '
        + U.sqlLit(p.kind) + ')');
    }
    return 'SELECT cp.call_point_id, cp.layer, cp.product, cp.funnel_name,\n'
      + '       (SELECT GROUP_CONCAT(DISTINCT j.stage) FROM journey_step j WHERE j.call_point_id = cp.call_point_id) AS stage,\n'
      + '       COALESCE(f.systems, 0) AS systems, COALESCE(f.events, 0) AS events,\n'
      + "       (SELECT MIN(e.gtm_tagged) FROM event e WHERE e.call_point_id = cp.call_point_id AND e.system_id = 'gtm_datalayer' AND e.kind = 'track') AS gtm_tagged\n"
      + 'FROM call_point cp LEFT JOIN v_callpoint_fanout f USING(call_point_id)\n'
      + (w.length ? 'WHERE ' + w.join('\n  AND ') + '\n' : '')
      + 'ORDER BY cp.call_point_id';
  }

  function eventsSql(cp, p) {
    var w = ['call_point_id = ' + U.sqlLit(cp)];
    var sys = U.list(p.sys);
    if (sys.length) w.push('system_id IN (' + U.sqlIn(sys) + ')');
    if (p.kind) w.push('kind = ' + U.sqlLit(p.kind));
    return 'SELECT event_id, system_id, event_name, kind, naming_style, gtm_tagged, notes\n'
      + 'FROM event WHERE ' + w.join(' AND ') + '\nORDER BY system_id, event_name';
  }

  // Параметры всех событий точки вызова (с теми же фильтрами по системе и kind, что и список событий).
  function paramsSql(cp, p) {
    var w = ['e.call_point_id = ' + U.sqlLit(cp)];
    var sys = U.list(p.sys);
    if (sys.length) w.push('e.system_id IN (' + U.sqlIn(sys) + ')');
    if (p.kind) w.push('e.kind = ' + U.sqlLit(p.kind));
    if (p.tr !== '0') w.push("pa.added_by <> 'transport'");
    return 'SELECT e.event_id, e.system_id, e.event_name, pa.name, pa.value_expr, pa.value_kind, pa.value_literals,\n'
      + '       pa.presence, pa.pii_class, pa.added_by\n'
      + 'FROM param pa JOIN event e USING(event_id)\n'
      + 'WHERE ' + w.join('\n  AND ') + '\n'
      + 'ORDER BY pa.name, e.system_id, e.event_name';
  }

  /* -------------------------------------------------- таблицы событий/параметров

     Используются и во вкладке Events, и во вкладке Sources.
     opts: { params, callPoint, onSelectEvent? }. Выбор события хранится в params.ev
     и обновляется на месте: перерисовывается только панель параметров. */

  function detailTables(host, opts) {
    var p = opts.params;
    var row = U.el('div', { class: 'row-blocks' });
    var evHost = U.el('div');
    var paHost = U.el('div');
    row.appendChild(evHost);
    row.appendChild(paHost);
    host.appendChild(row);

    if (!opts.callPoint) {
      evHost.appendChild(waiting('События выбранной точки вызова', 'event',
        'Выберите точку вызова в таблице выше.'));
      paHost.appendChild(waiting('Параметры событий точки вызова', 'param',
        'Выберите точку вызова: здесь появятся параметры всех её событий по системам.'));
      return { setEvent: function () {} };
    }

    var cp = opts.callPoint;
    var res = DB.tryQuery(eventsSql(cp, p));
    var selIdx = -1;
    if (p.ev) res.rows.forEach(function (r, i) { if (String(r.event_id) === String(p.ev)) selIdx = i; });
    if (selIdx < 0 && p.ev) { p.ev = ''; U.setParams({ ev: '' }); }   // событие не из этой точки

    function paramsPanel() {
      Grid.destroyIn(paHost);
      var pres = DB.tryQuery(paramsSql(cp, p));
      var evSel = selIdx >= 0 ? res.rows[selIdx] : null;
      var toolbar = [];
      var pivot = p.pv === '1';
      var pvBtn = U.el('button', { class: 'btn' + (pivot ? ' btn-primary' : ''), text: 'сравнить',
        title: 'Показать поля строками, события колонками' });
      pvBtn.addEventListener('click', function () {
        p.pv = pivot ? '' : '1';
        U.setParams({ pv: p.pv });
        paramsPanel();
      });
      toolbar.push(pvBtn);
      var nEvents = 0, seen = {};
      pres.rows.forEach(function (r) { if (!seen[r.event_id]) { seen[r.event_id] = 1; nEvents++; } });
      var title = 'Параметры событий точки (' + nEvents + ' ' + plural(nEvents, 'событие', 'события', 'событий') + ')'
        + (evSel ? ' · выбрано: ' + evSel.system_id + ' · ' + evSel.event_name : '');

      if (pivot) {
        pivotTable(paHost, pres, res.rows, evSel, title, toolbar);
        return;
      }
      Grid.table(paHost, {
        key: 'params-of-' + cp,
        title: title,
        source: 'param + event',
        hint: PA_HINT + (evSel ? '. Строки выбранного события подсвечены' : ''),
        result: pres,
        hidden: ['event_id', 'presence'],
        colSpecs: {
          system_id: { width: 140 }, event_name: { width: 190 }, name: { width: 160 },
          value_expr: { render: 'expr', flex: 3 }, value_kind: { width: 120 },
          value_literals: { width: 150 }, pii_class: { width: 110 }, added_by: { width: 100 }
        },
        hints: {
          groupBy: 'name',
          rowClass: function (r) { return evSel && String(r.event_id) === String(evSel.event_id) ? 'row-hl' : ''; }
        },
        toolbar: toolbar,
        maxRows: 12
      });
    }

    function setEvent(id) {
      selIdx = -1;
      res.rows.forEach(function (r, i) { if (String(r.event_id) === String(id)) selIdx = i; });
      p.ev = selIdx >= 0 ? String(id) : '';
      U.setParams({ ev: p.ev });
      paramsPanel();
      if (opts.onSelectEvent) opts.onSelectEvent(p.ev);
    }

    Grid.table(evHost, {
      key: 'events-of-' + cp,
      title: 'События точки ' + cp,
      source: 'event',
      hint: EV_HINT,
      result: res,
      hidden: ['event_id'],
      colSpecs: {
        system_id: { width: 150 }, event_name: { width: 230 },
        kind: { width: 110 }, naming_style: { width: 130 },
        gtm_tagged: { width: 90 }, notes: { render: 'long', flex: 3 }
      },
      select: 'single',
      selectedIndex: selIdx,
      onSelect: function (i, r) { setEvent(r.event_id); },
      maxRows: 8
    });

    paramsPanel();
    return { setEvent: setEvent };
  }

  // Сравнение: строки — имена полей, колонки — события точки, ячейка — value_expr.
  function pivotTable(host, pres, events, evSel, title, toolbar) {
    var cols = [], byId = {};
    events.forEach(function (e) {
      var label = e.system_id + ': ' + e.event_name;
      var key = 'e' + e.event_id;
      byId[e.event_id] = key;
      cols.push({ key: key, label: label, event_id: e.event_id });
    });
    var rowsByName = {}, order = [];
    pres.rows.forEach(function (r) {
      if (!rowsByName[r.name]) { rowsByName[r.name] = { name: r.name }; order.push(r.name); }
      var k = byId[r.event_id];
      if (k) rowsByName[r.name][k] = r.value_expr == null ? '' : r.value_expr;
    });
    var rows = order.map(function (n) { return rowsByName[n]; });
    var columns = ['name'].concat(cols.map(function (c) { return c.key; }));
    var specs = { name: { render: 'name', width: 170 } };
    cols.forEach(function (c) {
      specs[c.key] = { render: 'expr', headerName: c.label, minWidth: 180, flex: 1,
        tip: 'событие ' + c.label + ' (event_id ' + c.event_id + ')' };
    });
    Grid.table(host, {
      key: 'params-pivot',
      title: title,
      source: 'param × event',
      hint: PV_HINT,
      result: { columns: columns, rows: rows, sql: pres.sql },
      colSpecs: specs,
      hints: {
        cellClass: function (col, data) { return evSel && col === byId[evSel.event_id] ? 'cell-muted' : ''; }
      },
      toolbar: toolbar,
      maxRows: 14
    });
  }

  function plural(n, one, few, many) {
    var m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
    return many;
  }

  function waiting(title, source, text) {
    return U.el('div', { class: 'panel block' }, [
      U.el('div', { class: 'block-head' }, [
        U.el('span', { class: 'block-title', text: title }),
        U.el('span', { class: 'block-src', text: source })
      ]),
      U.el('div', { class: 'waiting', text: text })
    ]);
  }

  /* -------------------------------------------------------------- матрица */

  function matrixSql(p) {
    var sysCols = ['dataLayer', 'posthog', 'firebase_web', 'native_firebase', 'native_facebook',
      'appsflyer', 'customerio', 'gleam'];
    var w = [];
    if (p.layer) w.push('layer = ' + U.sqlLit(p.layer));
    if (p.product) w.push('product = ' + U.sqlLit(p.product));
    var sys = U.list(p.sys);
    if (sys.length) {
      w.push('(' + sys.map(function (s) {
        var c = s === 'gtm_datalayer' ? 'dataLayer' : s;
        return sysCols.indexOf(c) >= 0 ? c + ' IS NOT NULL' : '1 = 0';
      }).join(' OR ') + ')');
    }
    if (U.list(p.stage).length) {
      w.push('call_point_id IN (SELECT call_point_id FROM journey_step WHERE stage IN ('
        + U.sqlIn(U.list(p.stage)) + '))');
    }
    return {
      sysCols: sysCols,
      sql: 'SELECT call_point_id, layer, service, product, funnel_name, '
        + sysCols.join(', ') + ', systems\nFROM v_matrix'
        + (w.length ? '\nWHERE ' + w.join(' AND ') : '') + '\nORDER BY call_point_id'
    };
  }

  function matrix(host, p, onSelectCp) {
    var m = matrixSql(p);
    var res = DB.tryQuery(m.sql);
    var specs = {};
    m.sysCols.forEach(function (c) {
      specs[c] = { render: 'names', width: 150, tip: 'имя события в системе ' + Render.systemOfColumn(c) };
    });
    specs.call_point_id = { render: 'code', width: 260 };
    specs.systems = { render: 'count', width: 80 };

    Grid.table(host, {
      key: 'matrix',
      title: 'Матрица: точка вызова × система',
      source: 'v_matrix',
      hint: 'Строка — точка вызова, колонка — система, ячейка — имя события в этой системе. '
        + 'Пустая ячейка = система не получает это действие. Клик по строке открывает события и параметры ниже',
      result: res,
      colSpecs: specs,
      hidden: ['service', 'funnel_name'],
      hints: { collapseGroup: { title: 'контекст', cols: ['layer', 'product'] } },
      select: 'single',
      selectedIndex: p.cp ? res.rows.findIndex(function (r) { return r.call_point_id === p.cp; }) : -1,
      onSelect: function (i, r) { onSelectCp(r.call_point_id); },
      autoSize: false,
      height: 520,
      maxRows: 20
    });
    return res;
  }

  /* --------------------------------------------------------------- маршрут */

  function render(view, route) {
    var p = route.params;                       // живое состояние; меняется при выборе на месте
    function rerender(patch) {                  // смена фильтров — полная перерисовка маршрута
      var next = Object.assign({}, p, patch);
      Object.keys(next).forEach(function (k) { if (!next[k]) delete next[k]; });
      U.go(['events'], next);
    }

    filterBar(view, p, rerender);
    var chipsHost = U.el('div');
    view.appendChild(chipsHost);
    var masterHost = U.el('div');
    var detailHost = U.el('div');
    view.appendChild(masterHost);
    view.appendChild(detailHost);

    function refreshChips() { activeChips(chipsHost, p, rerender, LABELS); }

    function renderDetails() {
      Grid.destroyIn(detailHost);
      detailTables(detailHost, {
        params: p,
        callPoint: p.cp || null,
        onSelectEvent: refreshChips
      });
      refreshChips();
    }

    function selectCp(cp) {
      if (cp === p.cp) return;
      p.cp = cp;
      p.ev = '';
      U.setParams({ cp: cp, ev: '' });
      renderDetails();
    }

    if (p.mode === 'matrix') {
      var mres = matrix(masterHost, p, selectCp);
      if (p.cp && !mres.rows.some(function (r) { return r.call_point_id === p.cp; })) { p.cp = ''; p.ev = ''; U.setParams({ cp: '', ev: '' }); }
      renderDetails();
      return;
    }

    var res = DB.tryQuery(callPointsSql(p));
    var selIdx = -1;
    if (p.cp) res.rows.forEach(function (r, i) { if (r.call_point_id === p.cp) selIdx = i; });
    if (p.cp && selIdx < 0) { p.cp = ''; p.ev = ''; U.setParams({ cp: '', ev: '' }); }   // точка отфильтрована

    Grid.table(masterHost, {
      key: 'call-points',
      title: 'Точки вызова',
      source: 'call_point + v_callpoint_fanout + journey_step',
      hint: CP_HINT,
      result: res,
      colSpecs: {
        call_point_id: { render: 'code', width: 280 },
        layer: { width: 140 }, product: { width: 110 }, funnel_name: { width: 150 },
        stage: { render: 'stage', width: 170 },
        systems: { width: 90 }, events: { width: 90 },
        gtm_tagged: { render: 'bool', width: 100, tip: 'Слушает ли контейнер GTM dataLayer-имена этой точки: 1 = на каждое имя есть активный тег с точным триггером; 0 = хотя бы одно имя не слушает ни один тег (push есть, дальше GTM не уходит); пусто = точка не пушит в dataLayer' }
      },
      hints: {
        cellHtml: {
          // пусто = точка не пушит в dataLayer (не «неизвестно»), 0 = push есть, GTM не слушает
          gtm_tagged: function (v) {
            if (v == null || v === '') return '';
            return Number(v) ? '<span style="color:var(--ok)">✓</span>' : '<span style="color:var(--warn)" title="push есть, ни один активный тег GTM это имя не слушает">✗</span>';
          }
        }
      },
      select: 'single',
      selectedIndex: selIdx,
      onSelect: function (i, r) { selectCp(r.call_point_id); },
      maxRows: 12
    });

    renderDetails();
  }

  return { render: render, detailTables: detailTables, waiting: waiting, EV_HINT: EV_HINT, PA_HINT: PA_HINT };
})();
