/* Мини-Jinja строго по контракту report-conventions.md.
   Поддерживается ровно два элемента:
     {{ qN.col | q }}          — SQL-литерал с экранированием (числа без кавычек, NULL как NULL)
     {% if qN %} … {% endif %} — содержимое остаётся, только если в блоке qN выбрана строка
   Другой логики в шаблонах нет. */
'use strict';

var Jinja = (function () {

  var VAR = /\{\{\s*(q\d+)\.([A-Za-z_]\w*)\s*\|\s*q\s*\}\}/g;
  var IF = /\{%\s*if\s+(q\d+)\s*%\}([\s\S]*?)\{%\s*endif\s*%\}/g;

  function deps(sql) {
    var out = [], m;
    var re = new RegExp(VAR.source, 'g');
    while ((m = re.exec(sql))) if (out.indexOf(m[1]) < 0) out.push(m[1]);
    var re2 = new RegExp(IF.source, 'g');
    while ((m = re2.exec(sql))) if (out.indexOf(m[1]) < 0) out.push(m[1]);
    return out;
  }

  // ctx: { q1: {col: value} | null }
  function render(sql, ctx) {
    var out = sql.replace(new RegExp(IF.source, 'g'), function (_, blk, body) {
      return ctx[blk] ? body : '';
    });
    return out.replace(new RegExp(VAR.source, 'g'), function (_, blk, col) {
      var row = ctx[blk];
      if (!row) throw new NeedSelection(blk);
      if (!(col in row)) throw new Error('в блоке ' + blk + ' нет колонки ' + col);
      return U.sqlLit(row[col]);
    });
  }

  function NeedSelection(blk) {
    this.name = 'NeedSelection';
    this.block = blk;
    this.message = 'нет выбранной строки в ' + blk;
  }
  NeedSelection.prototype = Object.create(Error.prototype);

  return { render: render, deps: deps, NeedSelection: NeedSelection };
})();
