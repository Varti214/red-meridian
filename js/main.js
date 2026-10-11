'use strict';
/* ============================================================
   ЗАПУСК И ИГРОВОЙ ЦИКЛ
   1. Проверяем, загрузился ли 3D-движок (если нет — пробуем CDN).
   2. Загружаем карту (локально → CDN → аварийная схема).
   3. Запускаем карту (3D-глобус → при ошибке 2D-карта).
   4. Показываем вступление и крутим цикл: 1 игровой день = 1 секунда.
   ============================================================ */

(function () {
  const bar = document.getElementById('ld-bar');
  const stepEl = document.getElementById('ld-step');
  const progress = (p, text) => {
    bar.style.width = p + '%';
    if (text) stepEl.textContent = text;
  };
  // Даём браузеру перерисовать экран загрузки. Таймер, а не requestAnimationFrame:
  // rAF замирает в неактивных вкладках, и загрузка бы «зависала»
  const nextFrame = () => new Promise(r => setTimeout(r, 20));

  window.addEventListener('error', e => console.error('[error]', e.error || e.message));
  window.addEventListener('unhandledrejection', e => console.error('[promise]', e.reason));

  function loadScript(url, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      const t = setTimeout(() => { s.remove(); reject(new Error('timeout')); }, timeoutMs);
      s.src = url;
      s.onload = () => { clearTimeout(t); resolve(); };
      s.onerror = () => { clearTimeout(t); s.remove(); reject(new Error('load error')); };
      document.head.appendChild(s);
    });
  }

  // Если локальный бандл не загрузился — пробуем globe.gl с CDN (в нём свой Three.js внутри)
  async function ensureEngine() {
    if (typeof window.Globe === 'function') return 'local';
    const urls = [
      'https://cdn.jsdelivr.net/npm/globe.gl@2.46.2/dist/globe.gl.min.js',
      'https://unpkg.com/globe.gl@2.46.2/dist/globe.gl.min.js'
    ];
    for (const u of urls) {
      try {
        progress(12, 'Локальный 3D-движок недоступен, загрузка из сети…');
        await loadScript(u);
        if (typeof window.Globe === 'function') return 'cdn';
      } catch (e) {
        console.warn('[engine]', u, e.message);
      }
    }
    return 'none';
  }

  function startLoop() {
    let last = performance.now();
    let acc = 0;
    let tickErrors = 0;
    const frame = now => {
      requestAnimationFrame(frame);
      const dt = Math.min(250, now - last);
      last = now;
      const S = Game.S;
      // В сетевой игре дни считает сервер — браузер только показывает состояние
      if (Net.mp) { UI.setDayProgress(0); return; }
      if (!S || S.paused || S.over) {
        UI.setDayProgress(S && !S.over ? acc / CFG.SPEEDS[S.speed] : 0);
        return;
      }
      const msPerDay = CFG.SPEEDS[S.speed];
      acc += dt;
      let steps = 0;
      while (acc >= msPerDay && steps < 4) {
        acc -= msPerDay;
        steps++;
        try {
          Game.tick();
        } catch (e) {
          // Ошибка в одном такте не должна останавливать всю игру
          console.error('[tick]', e);
          if (++tickErrors <= 3) UI.toast('Внутренняя ошибка такта — игра продолжается', 'err');
        }
        if (Game.S !== S || S.paused || S.over) { acc = 0; break; }
      }
      if (steps === 4) acc = Math.min(acc, msPerDay);
      UI.setDayProgress(acc / msPerDay);
    };
    requestAnimationFrame(frame);
  }

  async function boot() {
    try {
      Sound.init();
      Net.init();
      progress(8, 'Проверка 3D-движка…');
      const engine = await ensureEngine();

      progress(20, 'Загрузка картографии…');
      const geoSource = await Geo.load(t => progress(28, t));
      progress(55, 'Расчёт границ и соседства…');
      await nextFrame();

      UI.init();
      // Мир на заднем плане вступления: создаём стартовое состояние (на паузе)
      Game.newGame('normal');

      progress(72, 'Развёртывание оперативной карты…');
      await nextFrame();
      const saved = U.storage.get('meridian_map_mode');
      const mode = MapView.init(document.getElementById('map-root'), saved === 'flat' ? 'flat' : 'globe', {
        click: id => UI.mapClick(id),
        hover: id => UI.mapHover(id)
      });
      UI.el.mapMode.querySelector('span').textContent = mode === 'globe' ? '2D-карта' : '3D-глобус';
      window.addEventListener('resize', () => MapView.resize());

      progress(100, 'Штаб готов');
      await nextFrame();
      const ld = document.getElementById('loading');
      ld.classList.add('done');
      setTimeout(() => ld.remove(), 700);

      if (geoSource === 'emergency') UI.toast('Карта не загрузилась — включена схематичная версия', 'warn');
      if (mode === 'flat' && saved !== 'flat') UI.toast(engine === 'none' ? '3D-движок недоступен — используется 2D-карта' : 'WebGL недоступен — используется 2D-карта', 'warn');

      UI.showIntro();
      startLoop();
    } catch (e) {
      console.error(e);
      stepEl.textContent = 'Ошибка запуска: ' + e.message + '. Обновите страницу (F5).';
      stepEl.classList.add('err');
    }
  }

  boot();
})();
