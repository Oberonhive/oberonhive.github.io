/* Таблица отчёта: ag-grid + шапка с tooltip, быстрый фильтр, экспорт CSV.
   Все таблицы приложения создаются только через Grid.table(). */
'use strict';

var Grid = (function () {

  var live = [];   // созданные таблицы — чтобы переключать тему ag-grid

  function themeClass() { return U.isDark() ? 'ag-theme-quartz-dark' : 'ag-theme-quartz'; }

  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () {
      live.forEach(function (g) {
        g.gridEl.className = 'block-grid ' + themeClass() + (g.selectable ? ' ag-selectable' : '');
      });
    });
  }

  var WIDE = { expr: 1, long: 1 };

  function buildColumns(opts) {
    var result = opts.result;
    var specs = opts.colSpecs || {};
    var hidden = opts.hidden || [];
    var hints = opts.hints || {};
    var cols = (opts.order && opts.order.length ? opts.order : result.columns)
      .filter(function (c) { return result.columns.indexOf(c) >= 0; });
    var big = result.rows.length > 200;

    var defs = cols.map(function (col) {
      var spec = specs[col] || {};
      var rname = spec.render || (hints.render && hints.render[col]) || Render.infer(col);
      var fn = Render.get(rname);
      var wide = WIDE[rname] === 1;
      var isCount = rname === 'count';

      var def = {
        field: col,
        headerName: spec.headerName || col,
        hide: hidden.indexOf(col) >= 0,
        headerTooltip: spec.tip || (hints.colTip && hints.colTip[col]) || DB.colDoc(col, opts.source) || col,
        filter: isCount ? 'agNumberColumnFilter' : 'agTextColumnFilter',
        sortable: true,
        resizable: true,
        minWidth: 70,
        type: isCount ? 'numericColumn' : undefined,
        tooltipValueGetter: function (p) { return p.value == null ? '' : String(p.value); },
        cellRenderer: function (p) {
          if (hints.cellHtml && hints.cellHtml[col]) {
            var custom = hints.cellHtml[col](p.value, p.data, col);
            if (custom != null) return custom;
          }
          return fn(p.value, p.data, col);
        },
        cellClass: function (p) {
          var cls = [];
          if (hints.cellClass) {
            var c = hints.cellClass(col, p.data, p.value);
            if (c) cls.push(c);
          }
          if (wide && !big) cls.push('cell-wrap');
          return cls.join(' ');
        }
      };
      if (spec.width) def.width = spec.width;
      else if (wide) def.flex = spec.flex || 2;
      else if (spec.flex) def.flex = spec.flex;
      else if (rname === 'code' || rname === 'name') def.width = 250;
      else if (rname === 'system' || rname === 'vendor' || rname === 'stage' || rname === 'pii') def.width = 140;
      else if (rname === 'names' || rname === 'literals') def.width = 150;
      else if (rname === 'role') def.width = 110;
      else if (rname === 'bool') def.width = 90;
      else if (isCount) def.width = 110;
      else def.flex = 1;

      // колонки с переносом не должны схлопываться, когда фиксированные ширины
      // не влезают в контейнер: лучше горизонтальная прокрутка, чем текст в 5 символов
      if (wide) def.minWidth = spec.minWidth || 240;
      if (wide && !big) { def.wrapText = true; def.autoHeight = true; }
      if (hints.flex && hints.flex[col]) { delete def.width; def.flex = hints.flex[col]; }
      return def;
    });

    // Хотя бы одна колонка должна тянуться, иначе справа остаётся пустое место.
    var visible = defs.filter(function (d) { return !d.hide; });
    if (visible.length && !visible.some(function (d) { return d.flex; })) {
      var pref = ['long', 'expr', 'name', 'code'];
      var pick = null;
      for (var k = 0; k < pref.length && !pick; k++) {
        pick = visible.filter(function (d) {
          var r = (specs[d.field] || {}).render || (hints.render && hints.render[d.field]) || Render.infer(d.field);
          return r === pref[k];
        }).pop();
      }
      pick = pick || visible[visible.length - 1];
      pick.minWidth = pick.width || pick.minWidth;
      delete pick.width;
      pick.flex = 1;
    }

    // Группа «другие системы» — свёрнутые колонки (columnGroupShow: 'open').
    if (hints.collapseGroup) {
      var g = hints.collapseGroup;              // {title, cols:[...]}
      var inGroup = defs.filter(function (d) { return g.cols.indexOf(d.field) >= 0; });
      if (inGroup.length) {
        inGroup.forEach(function (d) { d.columnGroupShow = 'open'; });
        var rest = defs.filter(function (d) { return g.cols.indexOf(d.field) < 0; });
        defs = rest.concat([{ headerName: g.title, marryChildren: true, children: inGroup }]);
      }
    }
    return defs;
  }

  function sortRows(rows, hints, columns) {
    var out = rows.slice();
    if (hints.sort) out.sort(hints.sort);
    else if (hints.groupBy && columns.indexOf(hints.groupBy) >= 0) {
      var g = hints.groupBy;
      out.sort(function (a, b) {
        var av = a[g] == null ? '' : String(a[g]);
        var bv = b[g] == null ? '' : String(b[g]);
        if (hints.groupOrder) {
          var ai = hints.groupOrder.indexOf(av), bi = hints.groupOrder.indexOf(bv);
          if (ai >= 0 || bi >= 0) return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
        }
        return av < bv ? -1 : av > bv ? 1 : 0;
      });
    }
    return out;
  }

  /* ------------------------------------------------------------------ API */

  function table(host, opts) {
    var result = opts.result || { columns: [], rows: [] };
    var hints = opts.hints || {};
    var panel = U.el('div', { class: 'panel block' });

    // --- шапка
    var tip = (opts.source ? 'Источник: ' + opts.source + '. ' : '') + (opts.hint || '');
    var head = U.el('div', { class: 'block-head' }, [
      U.el('span', { class: 'block-title', title: tip, text: opts.title || '' }),
      opts.source ? U.el('span', { class: 'block-src', title: tip, text: opts.source }) : null,
      tip ? U.el('span', { class: 'block-src', title: tip, text: 'ⓘ' }) : null
    ]);
    var tools = U.el('div', { class: 'block-tools' });
    (opts.toolbar || []).forEach(function (t) { tools.appendChild(t); });
    head.appendChild(tools);
    panel.appendChild(head);

    if (result.error) {
      panel.appendChild(U.el('div', { class: 'sql-error', text: 'SQL: ' + result.error }));
      appendSql(panel, result.sql);
      host.appendChild(panel);
      return { el: panel, api: null };
    }

    if (!result.rows.length) {
      panel.appendChild(U.el('div', { class: 'empty' }, [
        U.el('div', { text: opts.hint || 'Строк нет.' }),
        U.el('div', { class: 'empty-count', text: '0 строк' })
      ]));
      appendSql(panel, result.sql);
      host.appendChild(panel);
      return { el: panel, api: null };
    }

    // --- данные
    var rows = sortRows(result.rows, hints, result.columns);
    rows.forEach(function (r, i) { r.__i = result.rows.indexOf(r); r.__pos = i; });
    if (hints.groupBy) {
      var g = hints.groupBy, prev = null;
      rows.forEach(function (r) {
        var v = r[g] == null ? '' : String(r[g]);
        r.__group = (prev !== null && v !== prev);
        prev = v;
      });
    }

    var selectable = opts.select === 'single';
    var programmatic = false;
    var lastSelected = (opts.selectedIndex != null && opts.selectedIndex >= 0) ? opts.selectedIndex : -1;
    var gridEl = U.el('div', { class: 'block-grid ' + themeClass() + (selectable ? ' ag-selectable' : '') });

    var count = U.el('span', { class: 'block-count', text: result.rows.length + ' строк' });
    tools.insertBefore(count, tools.firstChild);

    var qf = U.el('input', { class: 'qf', type: 'search', placeholder: 'фильтр…' });
    tools.appendChild(qf);
    var csv = U.el('button', { class: 'btn', text: 'CSV', title: 'Выгрузить видимые строки в CSV' });
    tools.appendChild(csv);

    var nrows = Math.min(rows.length, opts.maxRows || 14);
    var h = opts.height || Math.max(120, Math.min(560, nrows * 30 + 42));
    gridEl.style.height = h + 'px';
    panel.appendChild(gridEl);
    appendSql(panel, result.sql);
    host.appendChild(panel);

    var options = {
      columnDefs: buildColumns(opts),
      rowData: rows,
      rowHeight: 28,
      headerHeight: 32,
      animateRows: false,
      enableBrowserTooltips: true,
      tooltipShowDelay: 200,
      suppressCellFocus: !selectable,
      rowSelection: selectable
        ? { mode: 'singleRow', checkboxes: false, enableClickSelection: true }
        : undefined,
      defaultColDef: { filter: true, sortable: true, resizable: true, suppressMovable: false },
      getRowClass: function (p) {
        var cls = [];
        if (p.data.__group) cls.push('group-start');
        if (hints.rowClass) {
          var c = hints.rowClass(p.data);
          if (c) cls.push(c);
        }
        return cls.length ? cls.join(' ') : undefined;
      },
      onGridReady: function (e) {
        // ширины задаются width/flex; sizeColumnsToFit только по явному запросу,
        // иначе широкие отчётные таблицы сжимаются до нечитаемых заголовков
        if (opts.autoSize === true) e.api.sizeColumnsToFit();
        if (selectable && opts.selectedIndex != null && opts.selectedIndex >= 0) {
          // восстановление выбора из URL — программное, onSelect звать нельзя,
          // иначе выбор мастера сбрасывает выбор деталей и страница перерисовывается по кругу
          programmatic = true;
          try {
            e.api.forEachNode(function (n) {
              if (n.data.__i === opts.selectedIndex) { n.setSelected(true); e.api.ensureNodeVisible(n); }
            });
          } finally { programmatic = false; }
        }
      },
      onSelectionChanged: function (e) {
        if (!selectable || !opts.onSelect) return;
        if (programmatic || e.source === 'api' || e.source === 'apiSelectAll') return;
        var n = e.api.getSelectedNodes()[0];
        if (!n) return;
        if (n.data.__i === lastSelected) return;   // повторный клик по той же строке
        lastSelected = n.data.__i;
        opts.onSelect(n.data.__i, n.data);
      }
    };

    var api = agGrid.createGrid(gridEl, options);

    qf.addEventListener('input', U.debounce(function () {
      api.setGridOption('quickFilterText', qf.value);
      var vis = 0;
      api.forEachNodeAfterFilter(function () { vis++; });
      count.textContent = (qf.value ? vis + ' из ' + rows.length : rows.length + ' строк');
    }, 120));

    csv.addEventListener('click', function () {
      api.exportDataAsCsv({
        fileName: (opts.key || 'table') + '.csv',
        columnKeys: options.columnDefs.filter(function (d) { return d.field && !d.hide; })
          .map(function (d) { return d.field; })
      });
    });

    var rec = { gridEl: gridEl, selectable: selectable, api: api };
    live.push(rec);
    return { el: panel, api: api, gridEl: gridEl };
  }

  // Уничтожает таблицы внутри host (для перерисовки одной области без перезагрузки маршрута).
  function destroyIn(host) {
    live = live.filter(function (g) {
      if (host.contains(g.gridEl)) {
        try { g.api.destroy(); } catch (e) { /* уже уничтожена */ }
        return false;
      }
      return true;
    });
    U.clear(host);
  }

  function appendSql(panel, sql) {
    if (!sql) return;
    var d = U.el('details', { class: 'sqlbox' }, [
      U.el('summary', { text: 'показать SQL' }),
      U.el('pre', { text: sql })
    ]);
    panel.appendChild(d);
  }

  function reset() {
    live.forEach(function (g) { try { g.api.destroy(); } catch (e) { /* ignore */ } });
    live = [];
  }

  return { table: table, reset: reset, destroyIn: destroyIn, themeClass: themeClass };
})();
