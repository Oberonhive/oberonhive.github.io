/* База фактов: один раз грузим analytics.db в sql.js, запросы кэшируем по тексту SQL. */
'use strict';

var DB = (function () {
  var db = null;
  var cache = new Map();
  var meta = null;       // issues.json
  var dict = null;       // dictionary.json

  async function boot(progress) {
    progress && progress('sql.js (wasm)');
    var SQL = await initSqlJs({ locateFile: function (f) { return './vendor/sql.js/' + f; } });

    progress && progress('data/analytics.db');
    var res = await fetch('./data/analytics.db');
    if (!res.ok) throw new Error('не читается ./data/analytics.db: HTTP ' + res.status);
    var buf = await res.arrayBuffer();
    db = new SQL.Database(new Uint8Array(buf));

    progress && progress('data/issues.json');
    meta = await (await fetch('./data/issues.json')).json();

    progress && progress('data/dictionary.json');
    dict = await (await fetch('./data/dictionary.json')).json();

    buildDocIndex();
    return { db: db, meta: meta, dict: dict };
  }

  /* ------------------------------------------------------------- запросы */

  function query(sql) {
    if (cache.has(sql)) return cache.get(sql);
    var out;
    var stmt = db.prepare(sql);
    try {
      var rows = [];
      while (stmt.step()) rows.push(stmt.getAsObject());
      var columns = rows.length ? Object.keys(rows[0]) : columnsOf(stmt);
      out = { columns: columns, rows: rows, sql: sql };
    } finally {
      stmt.free();
    }
    cache.set(sql, out);
    return out;
  }

  // Имена колонок для пустой выборки: sql.js отдаёт их не всегда, тогда — из текста SELECT.
  function columnsOf(stmt) {
    try {
      var names = stmt.getColumnNames();
      if (names && names.length) return names;
    } catch (e) { /* ignore */ }
    return [];
  }

  function tryQuery(sql) {
    try { return query(sql); }
    catch (e) { return { columns: [], rows: [], sql: sql, error: String(e.message || e) }; }
  }

  function scalar(sql) {
    var r = query(sql);
    return r.rows.length ? r.rows[0][r.columns[0]] : null;
  }

  function values(sql) {
    var r = query(sql);
    return r.rows.map(function (row) { return row[r.columns[0]]; });
  }

  /* ------------------------------------------------- словарь для tooltip-ов */

  var docByTableCol = {};   // "table.col" -> описание
  var docByCol = {};        // "col" -> описание (первое встреченное)
  var tableDoc = {};        // "table" -> описание

  function buildDocIndex() {
    var t = (dict && dict.tables) || {};
    Object.keys(t).forEach(function (name) {
      tableDoc[name] = t[name].doc || '';
      var cols = t[name].columns || {};
      Object.keys(cols).forEach(function (c) {
        docByTableCol[name + '.' + c] = cols[c];
        if (!docByCol[c]) docByCol[c] = cols[c];
      });
    });
  }

  // source из yaml может быть «event + param» или «event (system_id = posthog)» —
  // берём из него все известные имена таблиц и ищем колонку сначала в них.
  function colDoc(col, source) {
    if (source) {
      var names = String(source).split(/[^A-Za-z0-9_]+/).filter(function (s) {
        return s && docTables().indexOf(s) >= 0;
      });
      for (var i = 0; i < names.length; i++) {
        var d = docByTableCol[names[i] + '.' + col];
        if (d) return d;
      }
    }
    return docByCol[col] || '';
  }

  var _tables = null;
  function docTables() {
    if (!_tables) _tables = Object.keys((dict && dict.tables) || {});
    return _tables;
  }

  function tableInfo(name) { return (dict && dict.tables && dict.tables[name]) || null; }

  function fieldDoc(table, column) {
    var rows = tryQuery(
      'SELECT value, description FROM field_doc WHERE table_name = ' + U.sqlLit(table) +
      ' AND column_name ' + (column ? '= ' + U.sqlLit(column) : 'IS NULL')).rows;
    return rows;
  }

  return {
    boot: boot, query: query, tryQuery: tryQuery, scalar: scalar, values: values,
    colDoc: colDoc, tableDoc: tableDoc, tableInfo: tableInfo, fieldDoc: fieldDoc,
    get meta() { return meta; },
    get dict() { return dict; },
    cacheSize: function () { return cache.size; }
  };
})();
