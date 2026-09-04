/* Вкладка Issues: список проблем и страница проблемы с интерактивным отчётом. */
'use strict';

var Issues = (function () {

  function bySeverity(a, b) {
    return (b.severity - a.severity) || a.num.localeCompare(b.num);
  }

  /* ------------------------------------------------------------- список */

  function listPanel(active) {
    var issues = DB.meta.issues.slice().sort(bySeverity);
    var hours = issues.reduce(function (s, i) { return s + (i.hours || 0); }, 0);
    var panel = U.el('div', { class: 'panel issue-list' }, [
      U.el('div', { class: 'issue-list-head' }, [
        U.el('span', { text: 'Проблемы' }),
        U.el('small', { text: issues.length + ' · ~' + hours + ' ч' })
      ])
    ]);
    issues.forEach(function (it) {
      var item = U.el('a', {
        class: 'issue-item' + (it.num === active ? ' active' : ''),
        href: U.buildHash(['issues', it.num], {})
      }, [
        U.el('div', { class: 'issue-item-top' }, [
          U.el('span', { class: 'issue-num', text: '№' + it.num }),
          U.el('span', { html: Render.severityBadge(it.severity) }),
          U.el('span', { class: 'issue-hours', text: it.hours + ' ч' })
        ]),
        U.el('div', { class: 'issue-item-title', text: it.title }),
        U.el('div', { class: 'issue-item-meta', html: it.stages.map(function (s) {
          return '<span class="badge badge-stage">' + U.esc(s) + '</span>';
        }).join(' ') })
      ]);
      panel.appendChild(item);
    });
    return panel;
  }

  /* ------------------------------------------------------- страница проблемы */

  function page(view, params) {
    var num = params.num;
    var issue = DB.meta.issues.filter(function (i) { return i.num === num; })[0];
    var split = U.el('div', { class: 'split' });
    split.appendChild(listPanel(num));

    var right = U.el('div');
    split.appendChild(right);
    view.appendChild(split);

    if (!issue) {
      right.appendChild(U.el('div', { class: 'panel' }, [
        U.el('div', { class: 'issue-body', text: 'Проблема не найдена. Выберите из списка слева.' })
      ]));
      return;
    }

    var head = U.el('div', { class: 'panel' }, [
      U.el('div', { class: 'issue-head' }, [
        U.el('h1', { html: '<span class="issue-num">№' + U.esc(issue.num) + '</span>' + U.esc(issue.title) }),
        U.el('div', { class: 'issue-head-meta', html:
          Render.severityBadge(issue.severity)
          + '<span class="badge badge-plain" title="' + U.esc(issue.hours_detail || '') + '">'
          + issue.hours + ' ч' + (issue.hours_detail ? ' · ' + U.esc(issue.hours_detail) : '') + '</span>'
          + issue.stages.map(function (s) { return '<span class="badge badge-stage">' + U.esc(s) + '</span>'; }).join('')
        })
      ]),
      U.el('div', { class: 'issue-body prose', html: (issue.sections.description || {}).html || '' })
    ]);
    right.appendChild(head);

    var navBtnHost = U.el('div', { class: 'chipbar' }, [
      U.el('span', { class: 'chipbar-label', text: 'навигатор' })
    ]);
    right.appendChild(navBtnHost);

    var reportHost = U.el('div');
    right.appendChild(reportHost);

    var ctxRef = renderReport(reportHost, issue, params);
    buildNavButton(navBtnHost, issue, ctxRef);

    // раскрывающиеся разделы
    var tail = U.el('div', { class: 'panel' });
    ['facts', 'consequences', 'fix'].forEach(function (key) {
      var s = issue.sections[key];
      if (!s) return;
      tail.appendChild(U.el('details', { class: 'section' }, [
        U.el('summary', { text: s.title }),
        U.el('div', { class: 'section-body prose', html: s.html })
      ]));
    });
    if (issue.questions && issue.questions.length) {
      tail.appendChild(U.el('details', { class: 'section' }, [
        U.el('summary', { text: 'Вопросы команде (' + issue.questions.length + ')' }),
        U.el('div', { class: 'section-body' }, [
          U.el('ul', { class: 'checklist', html: issue.questions.map(function (q) {
            return '<li><span>' + q + '</span></li>';
          }).join('') })
        ])
      ]));
    }
    if (issue.notes_html) {
      tail.appendChild(U.el('details', { class: 'section' }, [
        U.el('summary', { text: 'Примечания к отчёту' }),
        U.el('div', { class: 'section-body prose', html: issue.notes_html })
      ]));
    }
    right.appendChild(tail);
  }

  function buildNavButton(host, issue, ctxRef) {
    var btn = U.el('button', { class: 'btn btn-primary', text: 'Открыть в навигаторе' });
    var note = U.el('span', { class: 'chipbar-label' });
    host.appendChild(btn);
    host.appendChild(note);

    function target() {
      var cp = null;
      Object.keys(ctxRef.ctx).forEach(function (k) {
        var row = ctxRef.ctx[k];
        if (!cp && row && row.call_point_id) cp = row.call_point_id;
      });
      return cp;
    }
    function refresh() {
      var cp = target();
      note.textContent = cp ? 'точка вызова: ' + cp
        : 'выберите строку в отчёте, чтобы перейти к её точке вызова';
    }
    ctxRef.onChange = refresh;
    refresh();

    btn.addEventListener('click', function () {
      var cp = target();
      var p = {};
      if (cp) p.cp = cp;
      else if (issue.stages.length && issue.stages[0] !== 'все') p.stage = issue.stages.join(',');
      U.go(['events'], p);
    });
  }

  /* ------------------------------------------------------------- отчёт */

  function renderReport(host, issue, params) {
    var rep = issue.report;
    var ctxRef = { ctx: {}, onChange: null };
    if (!rep || !rep.blocks.length) {
      host.appendChild(U.el('div', { class: 'panel' }, [
        U.el('div', { class: 'empty', text: 'В файле проблемы нет машинной секции отчёта.' })
      ]));
      return ctxRef;
    }

    var wrappers = {};
    rep.layout.forEach(function (row) {
      var r = U.el('div', { class: 'row-blocks' });
      row.forEach(function (id) {
        var w = U.el('div');
        wrappers[id] = w;
        r.appendChild(w);
      });
      host.appendChild(r);
    });
    // блоки, не попавшие в layout
    rep.blocks.forEach(function (b) {
      if (wrappers[b.id]) return;
      var r = U.el('div', { class: 'row-blocks' });
      var w = U.el('div');
      wrappers[b.id] = w;
      r.appendChild(w);
      host.appendChild(r);
    });

    var blocks = rep.blocks;
    var byId = {};
    blocks.forEach(function (b, i) { byId[b.id] = i; });

    function depsOf(b) {
      var d = Jinja.deps(b.sql);
      if (b.depends_on && d.indexOf(b.depends_on) < 0) d.push(b.depends_on);
      return d;
    }

    function descendants(id) {
      var set = [id], out = [];
      blocks.forEach(function (b) {
        if (depsOf(b).some(function (d) { return set.indexOf(d) >= 0; })) {
          set.push(b.id);
          out.push(b.id);
        }
      });
      return out;
    }

    function paramKey(id) { return id; }

    function renderOne(i) {
      var b = blocks[i];
      var w = U.clear(wrappers[b.id]);
      var deps = depsOf(b);
      var missing = deps.filter(function (d) { return !ctxRef.ctx[d]; });

      if (missing.length) {
        ctxRef.ctx[b.id] = null;
        var names = missing.map(function (d) {
          var m = blocks[byId[d]];
          return '„' + ((m && m.title) || d) + '“';
        }).join(', ');
        var p = U.el('div', { class: 'panel block' }, [
          U.el('div', { class: 'block-head' }, [
            U.el('span', { class: 'block-title', text: b.title || b.id }),
            b.source ? U.el('span', { class: 'block-src', text: b.source }) : null
          ]),
          U.el('div', { class: 'waiting', text: 'Выберите строку в ' + names + '.' })
        ]);
        w.appendChild(p);
        return;
      }

      var sql;
      try {
        sql = Jinja.render(b.sql, ctxRef.ctx);
      } catch (e) {
        w.appendChild(U.el('div', { class: 'panel block' }, [
          U.el('div', { class: 'block-head' }, [U.el('span', { class: 'block-title', text: b.title || b.id })]),
          U.el('div', { class: 'sql-error', text: 'Шаблон: ' + (e.message || e) })
        ]));
        ctxRef.ctx[b.id] = null;
        return;
      }

      var res = DB.tryQuery(sql);
      var hints = Hints.forBlock(issue.num, b.id, res);
      var rows = res.rows;

      // фильтр по умолчанию, снимаемый чипом
      var toolbar = [];
      if (hints.defaultFilter) {
        var f = hints.defaultFilter;
        var off = params['f_' + b.id] === 'off';
        if (!off) {
          rows = rows.filter(function (r) { return String(r[f.col]) === String(f.value); });
        }
        var chip = U.el('span', {
          class: 'chip ' + (off ? '' : 'filter-active'),
          title: off ? 'включить фильтр по умолчанию' : 'снять фильтр',
          html: U.esc(f.label) + (off ? '' : ' <span class="x">×</span>')
        });
        chip.addEventListener('click', function () {
          params['f_' + b.id] = off ? '' : 'off';
          U.setParams({ ['f_' + b.id]: off ? '' : 'off' });
          renderFrom(i);
        });
        toolbar.push(chip);
      }

      // чипы-значения над таблицей (issue 14: система)
      if (hints.chipFilter) {
        var cf = hints.chipFilter;
        var pk = 'c_' + b.id;
        var picked = U.list(params[pk]);
        var vals = [];
        res.rows.forEach(function (r) {
          var v = r[cf.col];
          if (v != null && vals.indexOf(v) < 0) vals.push(v);
        });
        vals.forEach(function (v) {
          var on = picked.indexOf(String(v)) >= 0;
          var c = U.el('span', { class: 'chip' + (on ? ' on' : ''), html: Render.get(cf.render || 'text')(v) });
          c.addEventListener('click', function () {
            var next = U.toggleIn(picked.slice(), String(v));
            params[pk] = next.join(',');
            U.setParams({ [pk]: next.join(',') });
            renderFrom(i);
          });
          toolbar.push(c);
        });
        if (picked.length) {
          rows = rows.filter(function (r) { return picked.indexOf(String(r[cf.col])) >= 0; });
        }
      }

      var view = { columns: res.columns, rows: rows, sql: sql, error: res.error };
      var selKey = params[paramKey(b.id)];
      var selIdx = -1;
      if (b.select === 'single') {
        selIdx = U.findRowByKey(rows, res.columns, selKey);
        if (selIdx < 0 && selKey) selIdx = -1;
      }
      ctxRef.ctx[b.id] = selIdx >= 0 ? rows[selIdx] : null;

      function select(idx, row) {
        var key = U.rowKey(rows, idx, res.columns);
        params[paramKey(b.id)] = key;
        var patch = {};
        patch[paramKey(b.id)] = key;
        descendants(b.id).forEach(function (d) { patch[d] = ''; delete params[d]; });
        U.setParams(patch);
        ctxRef.ctx[b.id] = row;
        // карточки-мастер перерисовываем вместе с зависимыми, чтобы обновить активную карточку
        renderFrom(hints.display === 'cards' ? i : i + 1);
        if (ctxRef.onChange) ctxRef.onChange();
      }

      if (hints.display === 'card') {
        w.appendChild(cardPanel(b, view));
      } else if (hints.display === 'cards') {
        w.appendChild(cardsPanel(b, view, hints, selIdx, select));
      } else {
        var host2 = hints.collapsed ? null : w;
        var det = null;
        if (hints.collapsed) {
          det = U.el('details', { class: 'panel' }, [U.el('summary', { class: 'section', text: (b.title || b.id) + ' — показать' })]);
          det.firstChild.className = '';
          det.firstChild.style.cssText = 'cursor:pointer;padding:8px 10px;font-weight:600;';
          host2 = U.el('div');
          det.appendChild(host2);
          w.appendChild(det);
        }
        Grid.table(host2, {
          key: 'issue-' + issue.num + '-' + b.id,
          title: b.title || b.id,
          source: b.source,
          hint: (b.hint || '') + (hints.tipExtra ? ' ' + hints.tipExtra : ''),
          result: view,
          colSpecs: b.columns || {},
          hints: hints,
          select: b.select === 'single' ? 'single' : null,
          selectedIndex: selIdx,
          onSelect: select,
          maxRows: hints.maxRows,
          height: hints.height,
          toolbar: toolbar
        });
      }
    }

    function renderFrom(start) {
      for (var i = start; i < blocks.length; i++) renderOne(i);
    }

    renderFrom(0);
    return ctxRef;
  }

  /* ------------------------------------------------------------- карточки */

  function cardPanel(b, res) {
    var panel = U.el('div', { class: 'panel block' }, [
      U.el('div', { class: 'block-head' }, [
        U.el('span', { class: 'block-title', title: (b.source ? 'Источник: ' + b.source + '. ' : '') + (b.hint || ''), text: b.title || b.id }),
        b.source ? U.el('span', { class: 'block-src', text: b.source }) : null
      ])
    ]);
    if (!res.rows.length) {
      panel.appendChild(U.el('div', { class: 'empty' }, [
        U.el('div', { text: b.hint || 'Строк нет.' }), U.el('div', { class: 'empty-count', text: '0 строк' })
      ]));
      return panel;
    }
    var row = res.rows[0];
    var dl = U.el('dl', { class: 'kv' });
    res.columns.forEach(function (c) {
      dl.appendChild(U.el('dt', { text: c, title: DB.colDoc(c, b.source) || '' }));
      dl.appendChild(U.el('dd', { html: Render.get(Render.infer(c))(row[c], row, c) }));
    });
    panel.appendChild(dl);
    return panel;
  }

  function cardsPanel(b, res, hints, selIdx, onSelect) {
    var panel = U.el('div', { class: 'panel block' }, [
      U.el('div', { class: 'block-head' }, [
        U.el('span', { class: 'block-title', title: (b.source ? 'Источник: ' + b.source + '. ' : '') + (b.hint || ''), text: b.title || b.id }),
        b.source ? U.el('span', { class: 'block-src', text: b.source }) : null,
        U.el('span', { class: 'block-count', text: res.rows.length + ' строк' })
      ])
    ]);
    var wrap = U.el('div', { class: 'cards' });
    res.rows.forEach(function (row, i) {
      var card = U.el('div', { class: 'card' + (i === selIdx ? ' on' : '') }, [
        U.el('div', { class: 'card-value', text: String(row[hints.cardValue]) }),
        U.el('div', { class: 'card-label', text: String(row[hints.cardLabel]) }),
        hints.cardSub ? U.el('div', { class: 'card-label', text: hints.cardSub + ': ' + row[hints.cardSub] }) : null
      ]);
      card.addEventListener('click', function () { onSelect(i, row); });
      wrap.appendChild(card);
    });
    panel.appendChild(wrap);
    return panel;
  }

  /* --------------------------------------------------------------- маршрут */

  function render(view, route) {
    var num = route.path[1];
    if (!num) {
      var issues = DB.meta.issues.slice().sort(bySeverity);
      view.appendChild(U.el('div', { class: 'split' }, [listPanel(null), overview(issues)]));
      return;
    }
    page(view, Object.assign({ num: num }, route.params));
  }

  function overview(issues) {
    var panel = U.el('div', { class: 'panel' });
    panel.appendChild(U.el('div', { class: 'issue-head' }, [
      U.el('h1', { text: 'Аудит трекинга критического пути' }),
      U.el('div', { class: 'issue-head-meta', html:
        '<span class="badge badge-plain">' + issues.length + ' проблем</span>'
        + '<span class="badge badge-plain">~' + issues.reduce(function (s, i) { return s + i.hours; }, 0) + ' ч</span>'
        + snapshotBadges() })
    ]));
    panel.appendChild(U.el('div', { class: 'issue-body prose', html:
      '<p>Слева — список проблем по убыванию severity. Каждая страница — окно в сырые факты '
      + '<code>analytics.db</code>: таблицы отчёта показывают те самые строки, которые изменятся при фиксе. '
      + 'Выбор строки в мастер-таблице сужает зависимые таблицы и попадает в адрес страницы.</p>'
      + '<p>Вкладки <a href="#/events">Events</a>, <a href="#/sources">Sources</a> и '
      + '<a href="#/gtm">GTM &amp; Flags</a> — свободная навигация по тем же фактам.</p>' }));
    var t = U.el('div');
    panel.appendChild(t);
    var rows = issues.map(function (i) {
      return {
        num: i.num, severity: i.severity, hours: i.hours,
        stage: i.stages.join(', '), title: i.title
      };
    });
    Grid.table(t, {
      key: 'issues-overview',
      title: 'Проблемы',
      source: 'audit/issues/*.md',
      hint: 'Одна строка — один файл проблемы; severity и часы — из шапки файла',
      result: { columns: ['num', 'severity', 'hours', 'stage', 'title'], rows: rows },
      colSpecs: {
        num: { render: 'code', width: 70 },
        severity: { render: 'count', width: 90 },
        hours: { render: 'count', width: 80 },
        stage: { render: 'stage', width: 220 },
        title: { render: 'long', flex: 4 }
      },
      select: 'single',
      onSelect: function (i, row) { U.go(['issues', row.num], {}); },
      maxRows: 17
    });
    return panel;
  }

  function snapshotBadges() {
    var s = DB.meta.snapshot || {};
    return ['captured_at', 'web_version', 'apk_version', 'gtm_container_version']
      .filter(function (k) { return s[k]; })
      .map(function (k) { return '<span class="badge badge-plain" title="' + k + '">' + U.esc(s[k]) + '</span>'; })
      .join('');
  }

  return { render: render, snapshotBadges: snapshotBadges };
})();
