/* Визуальные подсказки из раздела «Задание агенту-верстальщику» каждой проблемы.
   Ключ — номер проблемы, внутри — id блока. Значение либо объект, либо функция
   от результата запроса (когда подсветка зависит от всех строк сразу).

   Поддерживаемые поля:
     render{col}      — переопределение render из словаря конвенций
     colTip{col}      — tooltip заголовка колонки
     cellHtml{col}    — своя разметка ячейки (вернуть null — рендерить как обычно)
     cellClass(col,row,value) -> css-класс
     rowClass(row)    -> css-класс
     groupBy, groupOrder — визуальная группировка: сортировка + разделитель групп
     sort(a,b)        — свой порядок строк
     flex{col}        — доля ширины
     collapseGroup    — {title, cols[]} свернуть колонки в группу
     display          — 'cards' (мастер-карточки) | 'card' (одна строка карточкой)
     collapsed        — блок свёрнут в аккордеон
     defaultFilter    — {col, value, label} фильтр по умолчанию, снимаемый чипом
     maxRows, height  — размер таблицы */
'use strict';

var Hints = (function () {

  function badge(text, cls) { return '<span class="badge ' + cls + '">' + U.esc(text) + '</span>'; }
  function mono(v) { return v == null || v === '' ? Render.dash() : '<span class="mono">' + U.esc(v) + '</span>'; }
  function empty(v) { return v == null || v === ''; }

  var H = {

    '01': {
      q1: {
        // Пустая ячейка dataLayer в строке role = success и есть проблема: только фон.
        cellClass: function (col, row, val) {
          if (col === 'dataLayer' && empty(val) && row.role === 'success') return 'cell-alert';
          return '';
        }
      },
      // «в q2 видно, что value/currency/transaction_id/items есть в posthog/firebase
      // и нет в dataLayer» — строки сгруппированы по системе
      q2: { groupBy: 'system_id' },
      q3: {
        rowClass: function (row) { return Number(row.event_sends_it) === 0 ? 'row-warn' : ''; },
        colTip: { reads_variable: 'имя переменной dataLayer из контейнера, см. gtm_variable' }
      }
    },

    '02': {
      q1: {
        cellHtml: {
          enclosing_method: function (v) {
            if (v === 'handleSocketNftBuy' || v === 'handleSocketNftUpgraded') {
              return '<span title="значение приходит из websocket-обработчика">⚡ ' + mono(v) + '</span>';
            }
            return null;
          }
        }
      },
      // «покупок в списке нет» — только через tooltip заголовка, не текстом в таблице
      q3: { tipExtra: 'Покупок в этом списке нет.' },
      q4: { render: { gating: 'long' }, flex: { gating: 4 } }
    },

    '03': {
      q1: {
        groupBy: 'call_point_id',
        cellHtml: {
          value_kind: function (v) {
            if (v === 'uuid') return badge('uuid', 'badge-alert');
            if (v === 'const') return badge('const', 'badge-plain');
            return null;
          }
        }
      },
      q3: { flex: { arg_expr: 4 } }
    },

    '04': {
      q1: { groupBy: 'stage', render: { points: 'names' } },
      q2: {
        cellHtml: {
          name: function (v) {
            return empty(v) ? '<span class="dash">(нет параметров)</span>' : null;
          }
        }
      },
      q3: {
        cellHtml: {
          arg_expr: function (v) {
            if (empty(v)) return null;
            var out = U.esc(v).replace(/&quot;([^&]*?)&quot;/g, '<strong>&quot;$1&quot;</strong>');
            return '<span class="mono wrap">' + out + '</span>';
          }
        }
      }
    },

    '05': {
      q1: {
        // внутри стадии: success, action, view, error
        sort: (function () {
          var ord = { success: 0, action: 1, view: 2, error: 3, identity: 4 };
          return function (a, b) {
            var s = String(a.stage).localeCompare(String(b.stage));
            if (s) return s;
            return (ord[a.role] == null ? 9 : ord[a.role]) - (ord[b.role] == null ? 9 : ord[b.role]);
          };
        })()
      },
      q3: function (res) {
        var allEmpty = res.rows.length > 0 && res.rows.every(function (r) { return empty(r.arg_expr); });
        return {
          cellClass: function (col) { return (allEmpty && col === 'arg_expr') ? 'cell-muted' : ''; }
        };
      },
      q4: { defaultFilter: { col: 'event_sends_it', value: 0, label: 'event_sends_it = 0' } }
    },

    '06': {
      q1: (function () {
        var consent = function (v) {
          if (v === 'denied') return badge('denied', 'badge-alert');
          if (v === 'granted') return badge('granted', 'badge-ok');
          return null;
        };
        return {
          cellHtml: {
            default_value: consent, necessary_value: consent, all_granted_value: consent
          }
        };
      })(),
      q2: {
        render: { gating: 'long' }, flex: { gating: 4 },
        cellHtml: {
          gating: function (v) {
            if (empty(v)) return null;
            return Render.highlight(v, ['до consentService.init()', 'не проверяет']);
          }
        }
      }
    },

    '07': {
      q1: {
        cellHtml: {
          value_expr: function (v) {
            if (empty(v)) return null;
            var kind = String(v).indexOf('String(') >= 0
              ? '<span class="chipv">string</span>' : '<span class="chipv chipv-legacy">number?</span>';
            return '<span class="mono wrap">' + U.esc(v) + '</span> ' + kind;
          }
        }
      },
      q5: { render: { pii_class: 'pii' } },
      q6: { display: 'card' }
    },

    '08': {
      q1: { groupBy: 'kind', render: { buckets: 'long' } },
      q3: { hintOnEmpty: true },
      q5: { collapsed: true, maxRows: 20 }
    },

    '09': {
      q1: {
        collapseGroup: {
          title: 'другие системы',
          cols: ['firebase_web', 'native_firebase', 'native_facebook', 'appsflyer', 'customerio', 'gleam']
        }
      },
      q3: {
        cellHtml: {
          names: function (v) {
            if (empty(v)) return null;
            return String(v).split(',').map(function (s) { return s.trim(); }).filter(Boolean)
              .map(function (s) {
                var taxonomy = /^(app_|site_)/.test(s);
                return '<span class="chipv ' + (taxonomy ? 'chipv-taxonomy' : 'chipv-legacy') + '" title="'
                  + (taxonomy ? 'новая таксономия (префикс app_/site_)' : 'legacy-имя') + '">' + U.esc(s) + '</span>';
              }).join('');
          }
        }
      }
    },

    '10': {
      q1: {
        render: { enclosing_method: 'code' },
        cellHtml: {
          trigger_kind: function (v) {
            if (empty(v)) return null;
            var color = v === 'subscription' ? '--ok' : v === 'init' ? '--v-ga4' : '--sys-sentry';
            return '<span class="badge badge-sys" style="--c:var(' + color + ')">' + U.esc(v) + '</span>';
          }
        }
      },
      q3: { rowClass: function (row) { return Number(row.paused) === 1 ? 'row-dim' : ''; } }
    },

    '11': {
      q1: {
        cellClass: function (col, row, val) {
          return (col === 'success_names' || col === 'error_names') && empty(val) ? 'cell-muted' : '';
        }
      },
      q3: { groupBy: 'stage' }
    },

    '12': {
      q1: { render: { value_literals: 'literals' } },
      q4: { render: { gating: 'long', in_apk: 'bool' }, flex: { gating: 4 } }
    },

    '13': {
      q1: { display: 'cards', cardValue: 'names', cardLabel: 'naming_style', cardSub: 'points' },
      q2: { groupBy: 'product' },
      q4: { render: { condition: 'expr' }, flex: { condition: 3 } }
    },

    '14': {
      q1: { chipFilter: { col: 'system_id', render: 'system' } },
      q3: { render: { gating: 'long', notes: 'long' }, flex: { gating: 3, notes: 3 } }
    },

    '15': {
      q3: { render: { product: 'literals' } }
    },

    '16': {
      q1: { groupBy: 'product', groupOrder: [''] },
      q4: { sort: function (a, b) { return String(a.call_point_id).localeCompare(String(b.call_point_id)); } }
    },

    '17': {
      q1: {
        render: { gating: 'long' }, flex: { gating: 4 },
        cellHtml: {
          gating: function (v) { return empty(v) ? null : Render.highlight(v, ['вне production']); }
        }
      },
      q2: { hintOnEmpty: true }
    }
  };

  function forBlock(issueNum, blockId, result) {
    var byIssue = H[issueNum] || {};
    var h = byIssue[blockId];
    if (typeof h === 'function') h = h(result);
    return h || {};
  }

  return { forBlock: forBlock, all: H };
})();
