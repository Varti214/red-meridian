'use strict';
/* ============================================================
   ОКНО МИРНОГО ДОГОВОРА: конференция после капитуляции
   и мирные переговоры на условиях.
   ============================================================ */

Object.assign(UI, {
  pc: null,          // текущая конференция: { mode, confId, callId, N, Y, sel, terms }
  pcLater: {},       // отложенные конференции: id → день, когда напомнить снова

  // Каждый такт: если у нас есть несостоявшаяся конференция — открыть её
  checkPeaceConf() {
    if (!this.started || !Game.S) return;
    const cf = Game.myConf(Game.me);
    if (!cf || this.isOpen('peace')) return;
    if ((this.pcLater[cf.id] || -1) > Game.S.day) return;
    if (this.eventQueue.length || this.modals.length || this.fxBusyUntil > performance.now()) return;
    this.openPeace({ conf: cf.id });
  },

  // Открыть по id конференции ({conf}) или по стране / региону противника ({id})
  openPeace(arg) {
    const S = Game.S, me = Game.me;
    let st = null;
    if (arg.conf) {
      const cf = (S.confs || []).find(f => f.id === arg.conf);
      if (!cf) return;
      st = { mode: 'conf', confId: cf.id, N: cf.n, Y: null };
    } else {
      const r = Game.r(arg.id);
      const Y = r && Game.isPower(r.ctrl) && r.ctrl !== me ? r.ctrl : null;
      const N = Y ? null : Game.peaceTarget(r || Game.c(arg.id));
      if (!Y && !N) return;
      const cf = N && N.capitulated === me && Game.myConf(me);
      if (cf && cf.n === N.id) return this.openPeace({ conf: cf.id });
      st = { mode: 'offer', callId: arg.id, N: N && N.id, Y };
    }
    st.sel = new Set();
    st.terms = new Set();
    this.pc = st;
    this.openModal({
      key: 'peace', cls: 'm-peace', html: '<div class="pc"></div>',
      onOpen: (el, m) => {
        this.pcEl = el.querySelector('.pc');
        this.pcModal = m;
        this.pcEl.addEventListener('click', e => this.onPeaceClick(e));
        this.renderPeace();
      },
      onClose: () => {
        if (this.pc && this.pc.mode === 'conf' && Game.myConf(me)) {
          this.pcLater[this.pc.confId] = Game.S.day + 7;
          this.toast('Конференция отложена: откройте её в панели страны или подождите неделю', 'info');
        }
        this.pc = null;
        MapView.refresh();
      }
    });
    MapView.refresh();
  },

  // Варианты и очки для текущего окна
  peaceData() {
    const st = this.pc, me = Game.me;
    if (st.Y) {
      return { score: Game.powerWarScore(me, st.Y), regions: Game.powerTreatyOptions(me, st.Y), terms: ['reparations'], name: POWERS[st.Y].name };
    }
    const N = Game.c(st.N);
    const cap = st.mode === 'conf';
    const o = Game.treatyOptions(me, N, cap);
    return { score: cap ? 100 : Game.warScore(me, N), regions: o.regions, terms: o.terms, name: N.name, N };
  },

  renderPeace() {
    const st = this.pc;
    if (!st || !this.pcEl) return;
    const d = this.peaceData();
    // Убираем то, что стало недоступно (регион ушёл, условие потеряло смысл)
    for (const id of [...st.sel]) if (!d.regions.some(r => r.id === id)) st.sel.delete(id);
    for (const t of [...st.terms]) if (!d.terms.includes(t)) st.terms.delete(t);
    const used = d.regions.filter(r => st.sel.has(r.id)).reduce((s, r) => s + r.cost, 0) + [...st.terms].reduce((s, t) => s + TREATY[t].cost, 0);
    const left = d.score - used;
    const conf = st.mode === 'conf';
    const allTaken = d.regions.length > 0 && d.regions.every(r => st.sel.has(r.id));

    const rows = d.regions.map(r => {
      const on = st.sel.has(r.id);
      const dis = !on && r.cost > left;
      const tags = [r.occupied ? 'занят нами' : 'не занят', r.capital ? 'столица' : ''].filter(Boolean).join(' · ');
      return `<button class="pc-row ${on ? 'on' : ''}" data-pr="${r.id}" ${dis ? 'disabled' : ''}>
        <span class="pc-chk"></span><span class="pc-nm">${U.esc(r.name)}<em>${tags}</em></span>
        <span class="pc-f">${r.factories} зав.</span><b>${r.cost}</b></button>`;
    }).join('') || '<div class="pc-empty">Нет земель, которые можно потребовать: займите регионы противника.</div>';

    const terms = d.terms.map(t => {
      const T = TREATY[t], on = st.terms.has(t);
      const dis = (!on && T.cost > left) || (allTaken && t !== 'reparations');
      return `<button class="pc-row pc-term ${on ? 'on' : ''}" data-pt="${t}" ${dis ? 'disabled' : ''}>
        <span class="pc-chk"></span><span class="pc-nm">${T.name}<em>${T.desc}</em></span><b>${T.cost}</b></button>`;
    }).join('') || '<div class="pc-empty">Других условий нет.</div>';

    let chance = '';
    if (!conf && !st.Y && d.N) {
      const p = Game.treatyChance(d.N, used, d.score);
      chance = `<div class="pc-chance">Шанс, что противник подпишет: <b>${U.pct(p)}</b>${used ? '' : ' (белый мир)'}</div>`;
    } else if (st.Y) {
      chance = `<div class="pc-chance">Решение примет второй игрок.</div>`;
    }
    const pct = d.score ? Math.min(100, 100 * used / d.score) : 0;
    const why = Game.canPeace(st.Y ? Game.ownerNation(Game.r(st.callId)) : d.N);

    this.pcEl.innerHTML = `
      <div class="pc-head"><svg><use href="#i-flag"/></svg><div>
        <div class="mh-k">${conf ? 'Мирная конференция · противник капитулировал' : 'Мирные переговоры'}</div>
        <h2>${U.esc(d.name)}</h2></div></div>
      <div class="pc-score"><span>Очки войны</span><b>${used} / ${d.score}</b>
        <div class="meter meter-gold"><i style="width:${pct}%"></i></div>
        <em>${conf ? 'Капитуляция даёт 100 очков.' : 'Очки — доля земли противника, которую мы держим (заводы и столица весят больше).'}</em></div>
      <div class="pc-cols">
        <div class="pc-col"><div class="pc-sec"><span>Земли</span>
          <button class="btn btn-sm" data-pa="occ">Все занятые</button><button class="btn btn-sm" data-pa="clear">Сбросить</button></div>
          <div class="pc-list">${rows}</div></div>
        <div class="pc-col"><div class="pc-sec"><span>Условия</span></div><div class="pc-list">${terms}</div>
          <div class="pc-note">Регионы, которые мы занимали, но не забрали, вернутся противнику. Наши регионы, занятые им, вернутся нам.</div></div>
      </div>
      ${chance}
      <div class="m-actions">
        ${conf ? '<button class="btn" data-pa="later">Отложить</button>' : `<button class="btn" data-pa="white" ${why ? 'disabled' : ''}>Белый мир</button>`}
        <button class="btn" data-pa="staff">Предложение штаба</button>
        <button class="btn btn-gold" data-pa="sign" ${(!conf && why) || used > d.score ? 'disabled' : ''}>${conf ? 'Подписать договор' : 'Предложить условия'}</button>
      </div>
      ${!conf && why ? `<div class="pc-why">${U.esc(why)}</div>` : ''}`;
  },

  onPeaceClick(e) {
    const st = this.pc;
    if (!st) return;
    const row = e.target.closest('[data-pr],[data-pt],[data-pa]');
    if (!row || row.disabled) return;
    Sound.play('click');
    if (row.dataset.pr) {
      const id = row.dataset.pr;
      st.sel.has(id) ? st.sel.delete(id) : st.sel.add(id);
      MapView.refresh();
    } else if (row.dataset.pt) {
      const t = row.dataset.pt;
      st.terms.has(t) ? st.terms.delete(t) : st.terms.add(t);
    } else {
      const a = row.dataset.pa, d = this.peaceData();
      if (a === 'clear') { st.sel.clear(); st.terms.clear(); }
      else if (a === 'occ') {
        let left = d.score - [...st.terms].reduce((s, t) => s + TREATY[t].cost, 0) - d.regions.filter(r => st.sel.has(r.id)).reduce((s, r) => s + r.cost, 0);
        for (const r of d.regions) if (r.occupied && !st.sel.has(r.id) && r.cost <= left) { st.sel.add(r.id); left -= r.cost; }
      } else if (a === 'staff') {
        const dem = st.Y ? { regions: d.regions.filter(r => r.cost).map(r => r.id), terms: [] } : Game.autoTreaty(Game.me, d.N, d.score, st.mode === 'conf');
        st.sel = new Set(); st.terms = new Set();
        let left = d.score;
        for (const id of dem.regions) { const r = d.regions.find(x => x.id === id); if (r && r.cost <= left) { st.sel.add(id); left -= r.cost; } }
        for (const t of dem.terms) st.terms.add(t);
      } else if (a === 'later') { this.closeModal(this.pcModal); return; }
      else if (a === 'white') {
        const id = st.callId;
        this.pc = null;
        this.closeModal(this.pcModal);
        Act.call('peace', st.Y ? Game.ownerNation(Game.r(id)).id : st.N).then(res => this.result(res));
        return;
      } else if (a === 'sign') {
        const dem = { regions: [...st.sel], terms: [...st.terms] };
        const call = st.mode === 'conf' ? Act.call('signTreaty', st.confId, dem) : Act.call('proposeTreaty', st.Y ? st.callId : st.N, dem);
        this.pc = null;
        this.closeModal(this.pcModal);
        call.then(res => this.result(res));
        return;
      }
      MapView.refresh();
    }
    this.renderPeace();
  },

  // Итог договора — короткое сообщение
  onTreaty(t) {
    if (t.power !== Game.me) return;
    const N = Game.c(t.n);
    const parts = [];
    if (t.annexed) parts.push('страна присоединена целиком');
    else if (t.regions.length) parts.push('регионов: ' + t.regions.length);
    if (t.terms.length) parts.push(t.terms.join(', '));
    this.toast(`Мирный договор с ${N ? N.name : '?'}: ${parts.join('; ') || 'статус-кво'}`, 'ok');
    Sound.play('ok');
  }
});
