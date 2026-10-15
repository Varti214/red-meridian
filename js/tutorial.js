'use strict';
/* ============================================================
   ОБУЧЕНИЕ ДЛЯ НОВИЧКОВ: пошаговые подсказки по интерфейсу.
   Запускается само в первой партии, повторить — Esc → «Обучение».
   ============================================================ */

const TUTORIAL = [
  { sel: '#tb-nation', title: 'Ваша держава', text: 'Здесь ваша держава и её правитель. Нажмите на портрет, чтобы увидеть бонусы идеологии и национальные духи.' },
  { sel: '.tb-resources', title: 'Ресурсы державы', text: '<b>ПВ</b> — политвласть, её тратят почти на всё. <b>Заводы</b> дают науку и победу (55% мировой промышленности). <b>Призывники</b> нужны для новых дивизий. Справа — мировая напряжённость: чем выше, тем ближе большая война.' },
  { sel: '.tb-clock', title: 'Время', text: '<kbd>Пробел</kbd> — пауза, <kbd>1</kbd>–<kbd>4</kbd> — скорость. Пока открыто окно, время стоит (в одиночной игре).' },
  { sel: '#map-root', title: 'Карта и регионы', text: 'Мир поделён на регионы, как в HOI4. Кликните по любому — откроется панель: владелец, заводы, войска, правитель, дипломатия. Колесо мыши — масштаб, <kbd>M</kbd> — 3D-глобус или 2D-карта.', pos: 'center' },
  { sel: '#army-box', title: 'Резерв и дивизии', text: 'Здесь формируются новые дивизии (+1, +5) по выбранному шаблону. «Шаблоны» — конструктор дивизий: пехота держит оборону, танки прорывают фронт. Из резерва собирают армии.' },
  { sel: '#fronts-box', title: 'Армии и фронты', text: 'Нажмите на карточку армии, затем на <b>свой</b> регион — армия пойдёт туда, на <b>соседний вражеский</b> — начнёт наступление. В панели армии есть приказ «Наступать по фронту»: армия будет воевать сама. У каждой армии свой генерал с навыками, а войска набираются опыта.' },
  { sel: '[data-ui="research"]', title: 'Наука и фокусы', text: '<kbd>R</kbd> — исследования (танки, промышленность, ядерное оружие), <kbd>F</kbd> — национальные фокусы: политический путь страны, смена лидера и идеологии.' },
  { sel: '[data-ui="trade"]', title: 'Ресурсы и торговля', text: '<kbd>T</kbd> — нефть, газ, сталь и редкие металлы. Нехватка ослабляет армию, экономику и науку: закупайте у других стран или захватывайте месторождения.' },
  { sel: '[data-ui="un"]', title: 'ООН и организации', text: '<kbd>U</kbd> — голосования Генассамблеи и Совбеза (с правом вето), ЕС, БРИКС, ОПЕК+, ШОС.' },
  { sel: '#log-panel', title: 'Журнал', text: 'Все события, бои и решения. Клик по записи покажет место на карте. Важные мировые новости всплывают газетой.' },
  { sel: null, title: 'Как начать войну', text: 'Откройте панель страны → «Обосновать войну» → дождитесь окончания → «Объявить войну». Захватите столичный регион — страна капитулирует, и на мирной конференции вы продиктуете условия: земли, марионетка, смена режима. В сетевой игре с другом можно заключить <b>военный союз</b> в панели его страны.<br><br>Удачи, верховный главнокомандующий! Повторить обучение: <kbd>Esc</kbd> → «Обучение».' }
];

Object.assign(UI, {
  tutStep: -1,
  maybeTutorial() {
    let done = false;
    try { done = !!U.storage.get('meridian_tut_done'); } catch (e) { /* хранилище недоступно */ }
    if (done || this.tutWait) return;
    // Ждём, пока закроются стартовые окна (новость, событие), и только тогда показываем обучение
    let tries = 0;
    const tryStart = () => {
      this.tutWait = null;
      if (!this.started || this.tutStep >= 0) return;
      if (this.modals.length || this.eventQueue.length) { if (++tries < 120) this.tutWait = setTimeout(tryStart, 1500); return; }
      this.startTutorial();
    };
    this.tutWait = setTimeout(tryStart, 1200);
  },
  startTutorial() {
    this.endTutorial(true);
    this.tutStep = 0;
    if (!Net.mp) this.pushPause();
    this.tutPaused = !Net.mp;
    this.showTutStep();
  },
  endTutorial(silent) {
    document.querySelectorAll('.tut-box, .tut-hole').forEach(x => x.remove());
    document.querySelectorAll('.tut-target').forEach(x => x.classList.remove('tut-target'));
    if (this.tutStep >= 0 && !silent) {
      try { U.storage.set('meridian_tut_done', '1'); } catch (e) { /* ничего */ }
      if (this.tutPaused) this.popPause();
    }
    if (!silent) this.tutPaused = false;
    this.tutStep = -1;
    window.removeEventListener('resize', this.tutResize);
  },
  showTutStep() {
    document.querySelectorAll('.tut-box, .tut-hole').forEach(x => x.remove());
    document.querySelectorAll('.tut-target').forEach(x => x.classList.remove('tut-target'));
    const st = TUTORIAL[this.tutStep];
    if (!st) return this.endTutorial();
    const el = st.sel && document.querySelector(st.sel);
    const visible = el && el.offsetParent !== null && el.getBoundingClientRect().width > 0;
    const box = document.createElement('div');
    box.className = 'tut-box glass';
    box.innerHTML = `<div class="tut-k">Обучение · ${this.tutStep + 1} из ${TUTORIAL.length}</div><h3>${st.title}</h3><p>${st.text}</p>
      <div class="tut-act"><button class="btn btn-sm" data-tut="skip">Пропустить обучение</button>
        ${this.tutStep ? '<button class="btn btn-sm" data-tut="back">Назад</button>' : ''}
        <button class="btn btn-gold btn-sm" data-tut="next">${this.tutStep === TUTORIAL.length - 1 ? 'Начать игру' : 'Дальше'}</button></div>`;
    document.body.appendChild(box);
    box.addEventListener('click', e => {
      const b = e.target.closest('[data-tut]');
      if (!b) return;
      Sound.play('click');
      if (b.dataset.tut === 'skip') return this.endTutorial();
      this.tutStep += b.dataset.tut === 'back' ? -1 : 1;
      this.showTutStep();
    });
    const place = () => {
      const bw = box.offsetWidth, bh = box.offsetHeight, W = window.innerWidth, H = window.innerHeight;
      let x = (W - bw) / 2, y = (H - bh) / 2;
      if (visible && st.pos !== 'center') {
        const r = el.getBoundingClientRect();
        el.classList.add('tut-target');
        // Под элементом, если есть место, иначе над ним; по горизонтали — рядом
        y = r.bottom + 12 + bh < H ? r.bottom + 12 : Math.max(8, r.top - bh - 12);
        x = U.clamp(r.left + r.width / 2 - bw / 2, 8, W - bw - 8);
        if (r.height > H * 0.5) { y = U.clamp(r.top + 40, 8, H - bh - 8); x = r.right + 12 + bw < W ? r.right + 12 : Math.max(8, r.left - bw - 12); }
      }
      box.style.left = x + 'px';
      box.style.top = y + 'px';
    };
    place();
    this.tutResize = () => place();
    window.addEventListener('resize', this.tutResize);
  }
});
