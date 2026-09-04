/* Точка входа: загрузка базы, hash-роутинг, отрисовка вкладок. */
'use strict';

(function () {

  var view = document.getElementById('view');
  var tabsEl = document.getElementById('nav-tabs');

  var ROUTES = {
    issues: Issues.render,
    events: Events.render,
    sources: Sources.render,
    gtm: Gtm.render
  };

  function setActiveTab(name) {
    Array.prototype.forEach.call(tabsEl.querySelectorAll('.tab[data-route]'), function (a) {
      a.classList.toggle('active', a.getAttribute('data-route') === name);
    });
  }

  function render() {
    var route = U.parseHash();
    var name = route.path[0] || 'issues';
    if (!ROUTES[name]) name = 'issues';
    setActiveTab(name);
    Grid.reset();
    U.clear(view);
    var t0 = performance.now();
    try {
      ROUTES[name](view, route);
    } catch (e) {
      view.appendChild(U.el('div', { class: 'boot' }, [
        U.el('div', { class: 'boot-title', text: 'Ошибка отрисовки' }),
        U.el('pre', { class: 'boot-error', text: (e && e.stack) || String(e) })
      ]));
      console.error(e);
    }
    document.getElementById('nav-status').textContent =
      Math.round(performance.now() - t0) + ' мс · ' + DB.cacheSize() + ' запросов в кэше';
    window.scrollTo(0, 0);
  }

  window.addEventListener('hashchange', render);

  var boot = document.getElementById('boot');
  var bootSub = document.getElementById('boot-sub');

  DB.boot(function (step) { bootSub.textContent = step; })
    .then(function () {
      var s = DB.meta.snapshot || {};
      document.getElementById('nav-snapshot').textContent =
        [s.captured_at, s.web_version ? 'web ' + s.web_version : null,
          s.apk_version ? 'apk ' + s.apk_version : null,
          s.gtm_container ? s.gtm_container + ' v' + s.gtm_container_version : null]
          .filter(Boolean).join(' · ');
      render();
    })
    .catch(function (e) {
      U.clear(boot);
      boot.appendChild(U.el('div', { class: 'boot-title', text: 'Не удалось загрузить данные' }));
      boot.appendChild(U.el('pre', { class: 'boot-error', text: (e && e.stack) || String(e) }));
      boot.appendChild(U.el('div', { class: 'boot-sub', text:
        'Открывайте страницу по http (например python3 -m http.server), не как file://; '
        + 'сервер должен отдавать .wasm с типом application/wasm.' }));
      console.error(e);
    });
})();
