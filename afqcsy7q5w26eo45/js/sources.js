/* Навигатор Sources: чанки → места вызова → события и параметры выбранного места. */
'use strict';

var Sources = (function () {

  var CH_HINT = 'Файл сборки; label собран из Angular-компонентов или имени трекера';
  var CS_HINT = 'Откуда дергается точка вызова; trigger_kind — из ngOnInit, обработчика, подписки или обёртки';

  var COMPONENTS_SQL =
    'WITH RECURSIVE split(chunk, label, comp, rest) AS (\n'
    + "  SELECT chunk, label, '', components || ',' FROM chunk WHERE components IS NOT NULL AND components <> ''\n"
    + '  UNION ALL\n'
    + "  SELECT chunk, label, TRIM(SUBSTR(rest, 1, INSTR(rest, ',') - 1)), SUBSTR(rest, INSTR(rest, ',') + 1)\n"
    + "  FROM split WHERE rest <> ''\n"
    + ')\n'
    + "SELECT comp AS component, chunk, label FROM split WHERE comp <> '' ORDER BY comp, label";

  function bar(host, p, rerender) {
    var b = U.el('div', { class: 'chipbar' }, [U.el('span', { class: 'chipbar-label', text: 'trigger_kind' })]);
    var picked = U.list(p.trigger);
    DB.values('SELECT DISTINCT trigger_kind FROM call_site WHERE trigger_kind IS NOT NULL ORDER BY 1')
      .forEach(function (v) {
        var on = picked.indexOf(v) >= 0;
        var c = U.el('span', { class: 'chip' + (on ? ' on' : ''), text: v });
        c.addEventListener('click', function () {
          rerender({ trigger: U.toggleIn(U.list(p.trigger), v).join(',') });
        });
        b.appendChild(c);
      });

    b.appendChild(U.el('span', { class: 'chipbar-label', text: 'стадия' }));
    var st = U.list(p.stage);
    DB.values('SELECT DISTINCT stage FROM journey_step ORDER BY stage_no').forEach(function (v) {
      var on = st.indexOf(v) >= 0;
      var c = U.el('span', { class: 'chip' + (on ? ' on' : ''), text: v });
      c.addEventListener('click', function () {
        rerender({ stage: U.toggleIn(U.list(p.stage), v).join(',') });
      });
      b.appendChild(c);
    });

    var m = U.el('button', { class: 'btn' + (p.mode === 'components' ? ' btn-primary' : ''), text: 'По компонентам' });
    m.addEventListener('click', function () { rerender({ mode: p.mode === 'components' ? '' : 'components', comp: '' }); });
    b.appendChild(m);
    host.appendChild(b);

    var labels = { trigger: 'trigger_kind', stage: 'стадия', comp: 'компонент', chunk: 'чанк', cs: 'место вызова', ev: 'событие' };
    var keys = Object.keys(labels).filter(function (k) { return p[k]; });
    if (!keys.length) return;
    var ab = U.el('div', { class: 'chipbar' }, [U.el('span', { class: 'chipbar-label', text: 'активно' })]);
    keys.forEach(function (k) {
      var c = U.el('span', { class: 'chip filter-active', html: U.esc(labels[k]) + ': ' + U.esc(p[k]) + ' <span class="x">×</span>' });
      c.addEventListener('click', function () {
        var patch = {};
        patch[k] = '';
        if (k === 'chunk') { patch.cs = ''; patch.ev = ''; }
        if (k === 'cs') patch.ev = '';
        rerender(patch);
      });
      ab.appendChild(c);
    });
    host.appendChild(ab);
  }

  function chunksSql(p) {
    var w = [];
    var tr = U.list(p.trigger), st = U.list(p.stage);
    if (tr.length) {
      w.push('EXISTS (SELECT 1 FROM call_site s WHERE s.chunk = c.chunk AND s.trigger_kind IN (' + U.sqlIn(tr) + '))');
    }
    if (st.length) {
      w.push('EXISTS (SELECT 1 FROM call_site s JOIN journey_step j USING(call_point_id) '
        + 'WHERE s.chunk = c.chunk AND j.stage IN (' + U.sqlIn(st) + '))');
    }
    if (p.comp) {
      w.push("(',' || REPLACE(c.components, ', ', ',') || ',') LIKE " + U.sqlLit('%,' + p.comp + ',%'));
    }
    return 'SELECT c.chunk, c.label, c.kind,\n'
      + '       COUNT(DISTINCT cs.call_site_id) AS sites, COUNT(DISTINCT cs.call_point_id) AS points\n'
      + 'FROM chunk c LEFT JOIN call_site cs USING(chunk)\n'
      + (w.length ? 'WHERE ' + w.join('\n  AND ') + '\n' : '')
      + 'GROUP BY c.chunk, c.label, c.kind\nORDER BY sites DESC, c.label';
  }

  function sitesSql(chunk, p) {
    var w = ['cs.chunk = ' + U.sqlLit(chunk)];
    var tr = U.list(p.trigger);
    if (tr.length) w.push('cs.trigger_kind IN (' + U.sqlIn(tr) + ')');
    if (U.list(p.stage).length) {
      w.push('cs.call_point_id IN (SELECT call_point_id FROM journey_step WHERE stage IN ('
        + U.sqlIn(U.list(p.stage)) + '))');
    }
    return 'SELECT cs.call_site_id, cs.call_point_id, cs.enclosing_method, cs.trigger_kind, cs.receiver, cs.arg_expr\n'
      + 'FROM call_site cs WHERE ' + w.join('\n  AND ') + '\nORDER BY cs.call_site_id';
  }

  function render(view, route) {
    var p = route.params;
    function rerender(patch) {
      var next = Object.assign({}, p, patch);
      Object.keys(next).forEach(function (k) { if (!next[k]) delete next[k]; });
      U.go(['sources'], next);
    }

    bar(view, p, rerender);

    if (p.mode === 'components') {
      var cres = DB.tryQuery(COMPONENTS_SQL);
      Grid.table(view, {
        key: 'components',
        title: 'Компоненты и чанки',
        source: 'chunk.components',
        hint: 'Одна строка — один Angular-компонент в одном чанке; поле components разложено по запятой',
        result: cres,
        colSpecs: {
          component: { render: 'code', width: 320 },
          chunk: { render: 'chunk', width: 220 },
          label: { render: 'long', flex: 2 }
        },
        select: 'single',
        selectedIndex: p.comp ? cres.rows.findIndex(function (r) { return r.component === p.comp; }) : -1,
        onSelect: function (i, r) { rerender({ comp: r.component, mode: '', chunk: r.chunk, cs: '', ev: '' }); },
        maxRows: 16
      });
      return;
    }

    var res = DB.tryQuery(chunksSql(p));
    var selIdx = p.chunk ? res.rows.findIndex(function (r) { return r.chunk === p.chunk; }) : -1;
    Grid.table(view, {
      key: 'chunks',
      title: 'Чанки',
      source: 'chunk + call_site',
      hint: CH_HINT,
      result: res,
      colSpecs: {
        chunk: { render: 'code', width: 230 },
        label: { render: 'long', flex: 3 },
        kind: { width: 110 }, sites: { width: 90 }, points: { width: 90 }
      },
      select: 'single',
      selectedIndex: selIdx,
      onSelect: function (i, r) { rerender({ chunk: r.chunk, cs: '', ev: '' }); },
      maxRows: 10
    });

    if (selIdx < 0) {
      view.appendChild(Events.waiting('Места вызова выбранного чанка', 'call_site',
        'Выберите чанк в таблице выше.'));
      return;
    }

    var sres = DB.tryQuery(sitesSql(p.chunk, p));
    var sIdx = p.cs ? sres.rows.findIndex(function (r) { return String(r.call_site_id) === String(p.cs); }) : -1;
    if (sIdx < 0 && sres.rows.length === 1) sIdx = 0;

    Grid.table(view, {
      key: 'call-sites',
      title: 'Места вызова: ' + (res.rows[selIdx].label || p.chunk),
      source: 'call_site',
      hint: CS_HINT,
      result: sres,
      hidden: ['call_site_id'],
      colSpecs: {
        call_point_id: { render: 'code', width: 260 },
        enclosing_method: { render: 'code', width: 210 },
        trigger_kind: { width: 130 },
        receiver: { render: 'code', width: 160 },
        arg_expr: { render: 'expr', flex: 3 }
      },
      select: 'single',
      selectedIndex: sIdx,
      onSelect: function (i, r) { rerender({ cs: r.call_site_id, ev: '' }); },
      maxRows: 10
    });

    // выбор события обновляется на месте внутри detailTables (params.ev + replaceState)
    Events.detailTables(view, {
      params: p,
      callPoint: sIdx >= 0 ? sres.rows[sIdx].call_point_id : null
    });
  }

  return { render: render };
})();
