/* Вкладка GTM & Flags: контейнер GTM-WQRPRMS (теги, триггеры, контракт) и фиче-флаги. */
'use strict';

var Gtm = (function () {

  function subtabs(host, p, rerender) {
    var bar = U.el('div', { class: 'chipbar subtabs' });
    [['gtm', 'GTM'], ['flags', 'Flags']].forEach(function (t) {
      var on = (p.sub || 'gtm') === t[0];
      var c = U.el('span', { class: 'chip' + (on ? ' on' : ''), text: t[1] });
      c.addEventListener('click', function () { rerender({ sub: t[0], tag: '', dl: '', flag: '' }); });
      bar.appendChild(c);
    });
    host.appendChild(bar);
  }

  function activeChips(host, p, rerender, labels) {
    var keys = Object.keys(labels).filter(function (k) { return p[k]; });
    if (!keys.length) return;
    var bar = U.el('div', { class: 'chipbar' }, [U.el('span', { class: 'chipbar-label', text: 'активно' })]);
    keys.forEach(function (k) {
      var c = U.el('span', { class: 'chip filter-active', html: U.esc(labels[k]) + ': ' + U.esc(p[k]) + ' <span class="x">×</span>' });
      c.addEventListener('click', function () {
        var patch = {};
        patch[k] = '';
        rerender(patch);
      });
      bar.appendChild(c);
    });
    host.appendChild(bar);
  }

  /* ---------------------------------------------------------------- GTM */

  function gtmView(view, p, rerender) {
    activeChips(view, p, rerender, { tag: 'тег', dl: 'имя dataLayer' });

    var tags = DB.tryQuery(
      'SELECT tag_id, vendor, vendor_event, gtm_function, consent_categories, paused,\n'
      + '       (SELECT COUNT(*) FROM gtm_route r WHERE r.tag_id = g.tag_id) AS routes\n'
      + 'FROM gtm_tag g ORDER BY CAST(tag_id AS INTEGER)');
    var selIdx = p.tag ? tags.rows.findIndex(function (r) { return String(r.tag_id) === String(p.tag); }) : -1;

    Grid.table(view, {
      key: 'gtm-tags',
      title: 'Теги контейнера',
      source: 'gtm_tag',
      hint: 'Теги контейнера GTM-WQRPRMS: одна строка — один тег и его настройки',
      result: tags,
      colSpecs: {
        tag_id: { render: 'code', width: 90 },
        vendor: { width: 200 }, vendor_event: { render: 'name', width: 190 },
        gtm_function: { render: 'code', width: 150 },
        consent_categories: { render: 'long', flex: 2 },
        paused: { width: 90 }, routes: { render: 'count', width: 90 }
      },
      hints: { rowClass: function (r) { return Number(r.paused) === 1 ? 'row-dim' : ''; } },
      select: 'single',
      selectedIndex: selIdx,
      onSelect: function (i, r) { rerender({ tag: r.tag_id }); },
      maxRows: 12
    });

    var row = U.el('div', { class: 'row-blocks' });
    var a = U.el('div'), b = U.el('div');
    row.appendChild(a);
    row.appendChild(b);
    view.appendChild(row);

    if (selIdx < 0) {
      a.appendChild(Events.waiting('Триггеры выбранного тега', 'gtm_route', 'Выберите тег в таблице выше.'));
      b.appendChild(Events.waiting('Что читает выбранный тег', 'gtm_tag_param + gtm_variable', 'Выберите тег в таблице выше.'));
    } else {
      Grid.table(a, {
        key: 'gtm-routes',
        title: 'Триггеры тега ' + p.tag,
        source: 'gtm_route',
        hint: 'Одна строка — одно условие срабатывания тега; source_event — имя события dataLayer',
        result: DB.tryQuery('SELECT source_event, condition FROM gtm_route WHERE tag_id = '
          + U.sqlLit(p.tag) + ' ORDER BY source_event'),
        colSpecs: { source_event: { render: 'name', width: 220 }, condition: { render: 'expr', flex: 3 } },
        maxRows: 8
      });
      Grid.table(b, {
        key: 'gtm-tag-params',
        title: 'Что читает тег ' + p.tag,
        source: 'gtm_tag_param + gtm_variable',
        hint: 'Одна строка — один слот тега: параметр и переменная контейнера, из которой он берётся',
        result: DB.tryQuery(
          'SELECT tp.slot, tp.param, v.name AS reads_variable, v.source_kind, tp.literal\n'
          + 'FROM gtm_tag_param tp LEFT JOIN gtm_variable v USING(var_id)\n'
          + 'WHERE tp.tag_id = ' + U.sqlLit(p.tag) + '\nORDER BY tp.slot, tp.param'),
        colSpecs: {
          slot: { width: 130 }, param: { render: 'name', width: 170 },
          reads_variable: { render: 'name', width: 200 }, source_kind: { width: 130 },
          literal: { render: 'expr', flex: 2 }
        },
        maxRows: 8
      });
    }

    // контракт
    var unsentOff = p.unsent === 'off';
    var contract = DB.tryQuery(
      'SELECT source_event, tag_id, vendor, vendor_event, param, reads_variable, event_sends_it\n'
      + 'FROM v_gtm_contract WHERE paused = 0'
      + (unsentOff ? '' : '\n  AND event_sends_it = 0')
      + '\nORDER BY source_event, CAST(tag_id AS INTEGER), param');
    var chip = U.el('span', {
      class: 'chip ' + (unsentOff ? '' : 'filter-active'),
      html: 'event_sends_it = 0' + (unsentOff ? '' : ' <span class="x">×</span>'),
      title: unsentOff ? 'включить фильтр по умолчанию' : 'снять фильтр по умолчанию'
    });
    chip.addEventListener('click', function () { rerender({ unsent: unsentOff ? '' : 'off' }); });

    Grid.table(view, {
      key: 'gtm-contract',
      title: 'Контракт: что тег ждёт от события',
      source: 'v_gtm_contract',
      hint: 'Тег читает переменную dataLayer, которой нет в событии-триггере (event_sends_it = 0)',
      result: contract,
      colSpecs: {
        source_event: { render: 'name', width: 200 }, tag_id: { render: 'code', width: 80 },
        vendor: { width: 180 }, vendor_event: { render: 'name', width: 170 },
        param: { render: 'name', width: 160 }, reads_variable: { render: 'name', width: 190 },
        event_sends_it: { width: 130 }
      },
      hints: {
        rowClass: function (r) { return Number(r.event_sends_it) === 0 ? 'row-warn' : ''; },
        colTip: { reads_variable: 'имя переменной dataLayer из контейнера, см. gtm_variable' }
      },
      select: 'single',
      onSelect: function (i, r) { rerender({ tag: r.tag_id }); },
      toolbar: [chip],
      maxRows: 12
    });

    // обратный вход: имя dataLayer → теги на нём
    var names = DB.tryQuery(
      "SELECT e.event_name, COUNT(DISTINCT e.call_point_id) AS points,\n"
      + "       (SELECT COUNT(*) FROM gtm_route r WHERE r.source_event = e.event_name) AS tags\n"
      + "FROM event e WHERE e.system_id = 'gtm_datalayer' AND e.kind = 'track'\n"
      + 'GROUP BY e.event_name ORDER BY tags DESC, e.event_name');
    var dlIdx = p.dl ? names.rows.findIndex(function (r) { return r.event_name === p.dl; }) : -1;

    var row2 = U.el('div', { class: 'row-blocks' });
    var c = U.el('div'), d = U.el('div');
    row2.appendChild(c);
    row2.appendChild(d);
    view.appendChild(row2);

    Grid.table(c, {
      key: 'dl-names',
      title: 'Имена dataLayer, которые отправляет клиент',
      source: 'event (system_id = gtm_datalayer)',
      hint: 'Одна строка — одно имя, которое код пушит в dataLayer; tags — сколько триггеров контейнера его слушают',
      result: names,
      colSpecs: {
        event_name: { render: 'name', flex: 2 }, points: { render: 'count', width: 90 },
        tags: { render: 'count', width: 90 }
      },
      hints: { rowClass: function (r) { return Number(r.tags) === 0 ? 'row-warn' : ''; } },
      select: 'single',
      selectedIndex: dlIdx,
      onSelect: function (i, r) { rerender({ dl: r.event_name }); },
      maxRows: 10
    });

    if (dlIdx < 0) {
      d.appendChild(Events.waiting('Теги на выбранном имени', 'v_gtm_destination',
        'Выберите имя dataLayer слева.'));
    } else {
      Grid.table(d, {
        key: 'gtm-destination',
        title: 'Теги на имени ' + p.dl,
        source: 'v_gtm_destination',
        hint: 'Куда уходит это имя: вендор, событие вендора, согласия и условие срабатывания',
        result: DB.tryQuery('SELECT vendor, vendor_event, ids, consent_categories, paused, condition\n'
          + 'FROM v_gtm_destination WHERE source_event = ' + U.sqlLit(p.dl) + '\nORDER BY vendor'),
        colSpecs: {
          vendor: { width: 180 }, vendor_event: { render: 'name', width: 170 },
          ids: { render: 'code', width: 160 }, consent_categories: { render: 'long', flex: 2 },
          paused: { width: 80 }, condition: { render: 'expr', flex: 2 }
        },
        maxRows: 10
      });
    }
  }

  /* -------------------------------------------------------------- Flags */

  function flagsView(view, p, rerender) {
    activeChips(view, p, rerender, { flag: 'флаг' });

    var kindDoc = {};
    DB.fieldDoc('feature_flag', 'kind').forEach(function (r) {
      if (r.value) kindDoc[r.value] = r.description;
      else kindDoc.__ = r.description;
    });

    var res = DB.tryQuery('SELECT flag_id, key, kind, config_value, buckets, targeting\n'
      + 'FROM feature_flag ORDER BY kind, key');
    var selIdx = p.flag ? res.rows.findIndex(function (r) { return String(r.flag_id) === String(p.flag); }) : -1;

    Grid.table(view, {
      key: 'flags',
      title: 'Фиче-флаги и конфиги',
      source: 'feature_flag',
      hint: 'Одна строка — один ключ из кода: конфиг, флаг A/B, переменная окружения или список таргетинга'
        + (kindDoc.__ ? '. ' + kindDoc.__ : ''),
      result: res,
      hidden: ['flag_id'],
      colSpecs: {
        key: { render: 'code', width: 260 },
        kind: { width: 150, tip: kindDoc.__ || 'вид ключа' },
        config_value: { render: 'expr', flex: 2 },
        buckets: { render: 'long', flex: 2 },
        targeting: { render: 'long', flex: 2 }
      },
      hints: { groupBy: 'kind' },
      select: 'single',
      selectedIndex: selIdx,
      onSelect: function (i, r) { rerender({ flag: r.flag_id }); },
      maxRows: 14
    });

    if (selIdx >= 0) {
      var full = DB.tryQuery('SELECT * FROM feature_flag WHERE flag_id = ' + U.sqlLit(p.flag));
      var row = full.rows[0];
      var dl = U.el('dl', { class: 'kv' });
      full.columns.forEach(function (col) {
        dl.appendChild(U.el('dt', { text: col, title: DB.colDoc(col, 'feature_flag') || '' }));
        dl.appendChild(U.el('dd', { html: Render.get(Render.infer(col))(row[col], row, col) }));
      });
      view.appendChild(U.el('div', { class: 'panel block' }, [
        U.el('div', { class: 'block-head' }, [
          U.el('span', { class: 'block-title', text: 'Флаг ' + row.key }),
          U.el('span', { class: 'block-src', text: 'feature_flag' })
        ]),
        dl
      ]));
    } else {
      view.appendChild(Events.waiting('Выбранный флаг целиком', 'feature_flag', 'Выберите флаг в таблице выше.'));
    }

    var row2 = U.el('div', { class: 'row-blocks' });
    var a = U.el('div'), b = U.el('div');
    row2.appendChild(a);
    row2.appendChild(b);
    view.appendChild(row2);

    Grid.table(a, {
      key: 'consent-mode',
      title: 'Consent Mode',
      source: 'consent_mode',
      hint: 'Значения gtag(consent) из кода: по умолчанию, при «только необходимые» и при полном согласии',
      result: DB.tryQuery('SELECT setting, default_value, necessary_value, all_granted_value, form_field FROM consent_mode'),
      colSpecs: {
        setting: { render: 'code', width: 180 },
        default_value: { width: 110 }, necessary_value: { width: 130 },
        all_granted_value: { width: 130 }, form_field: { render: 'code', flex: 1 }
      },
      hints: {
        cellHtml: {
          default_value: consentCell, necessary_value: consentCell, all_granted_value: consentCell
        }
      },
      maxRows: 8
    });

    Grid.table(b, {
      key: 'systems',
      title: 'Системы: транспорт, гейтинг, согласия',
      source: 'system',
      hint: 'Справочник систем-приёмников: как уходят данные и при каких условиях система молчит',
      result: DB.tryQuery('SELECT system_id, kind, transport, gating, consent_categories, in_apk FROM system ORDER BY system_id'),
      colSpecs: {
        system_id: { width: 160 }, kind: { width: 130 },
        transport: { render: 'long', flex: 2 }, gating: { render: 'long', flex: 4 },
        consent_categories: { render: 'long', flex: 2 }, in_apk: { width: 80 }
      },
      maxRows: 8
    });
  }

  function consentCell(v) {
    if (v === 'denied') return '<span class="badge badge-alert">denied</span>';
    if (v === 'granted') return '<span class="badge badge-ok">granted</span>';
    return null;
  }

  function render(view, route) {
    var p = route.params;
    function rerender(patch) {
      var next = Object.assign({}, p, patch);
      Object.keys(next).forEach(function (k) { if (!next[k]) delete next[k]; });
      U.go(['gtm'], next);
    }
    subtabs(view, p, rerender);
    if ((p.sub || 'gtm') === 'flags') flagsView(view, p, rerender);
    else gtmView(view, p, rerender);
  }

  return { render: render };
})();
