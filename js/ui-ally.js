'use strict';
/* ============================================================
   ОКНО СОЮЗА: армии, фронты, ресурсы союзников и помощь им.
   Открывается кнопкой «Союз» вверху (видна, когда союз заключён) или клавишей A.
   ============================================================ */

Object.assign(UI, {
  openAlliance() {
    if (!Game.alliesOfPower(Game.me).length) return this.toast('Союза нет. Предложить его можно в панели региона другой державы-игрока.', 'info');
    this.allySigV = null;
    this.openModal({
      key: 'ally', cls: 'm-ally', html: '<div class="al"></div>',
      onOpen: el => {
        this.alEl = el.querySelector('.al');
        this.alEl.addEventListener('click', e => this.onAllyClick(e));
        this.renderAlliance(true);
      },
      onClose: () => { this.alEl = null; }
    });
  },

  allySig() {
    const team = [Game.me, ...Game.alliesOfPower(Game.me)];
    return JSON.stringify(team.map(t => {
      const P = Game.P(t);
      return [t, Math.round(P.pp / 5), P.divs, P.armies.map(a => [a.id, Math.round(a.divs), a.loc, a.order.type, a.front]), Game.fronts(t).length, Game.lands(t).length];
    }).concat([Game.contracts().filter(x => x.price === 0)]));
  },

  renderAlliance(force) {
    if (!this.alEl) return;
    const sig = this.allySig();
    if (!force && sig === this.allySigV) return;
    this.allySigV = sig;
    const me = Game.me, team = [me, ...Game.alliesOfPower(me)];
    const cols = team.map(t => {
      const P = Game.P(t), D = POWERS[t], b = Game.resBalance(t);
      const enemies = [...new Set(Game.fronts(t).map(c => { const N = Game.peaceTarget(c); return N ? (Game.isPower(N.ctrl) ? POWERS[N.ctrl].name : N.name) : null; }).filter(Boolean))];
      const res = RES_KEYS.map(k => `<span class="${b[k].short > 0.05 ? 'neg' : ''}" style="--rc:${RES[k].color}" data-tip="${RES[k].name}: есть ${U.fmt(b[k].have, 1)} из ${U.fmt(b[k].need, 1)}"><svg><use href="#${RES[k].icon}"/></svg>${U.fmt(b[k].have, 0)}/${U.fmt(b[k].need, 0)}</span>`).join('');
      const armies = P.armies.map(a => {
        const loc = Game.r(a.loc) || { name: '?' };
        const st = a.order.type === 'attack' ? 'наступает: ' + (Game.r(a.order.target) || { name: '?' }).name
          : a.order.type === 'move' ? 'на марше' : a.front === 'attack' ? 'по фронту' : a.front === 'defend' ? 'держит фронт' : 'оборона';
        return `<button class="al-army" data-algo="${a.loc}"><b>${U.esc(a.name)}</b><span>${U.fmt(a.divs, 1)} див. · ${U.esc(loc.name)} · ${st}</span><em>${U.esc(a.general)} · ${Game.veterancy(a.xp).name.toLowerCase()}</em></button>`;
      }).join('') || '<div class="pc-empty">Армий нет.</div>';
      let help = '';
      if (t !== me) {
        const gifts = Game.contracts().filter(x => x.seller === me && x.buyer === t && x.price === 0);
        const resBtns = RES_KEYS.map(k => {
          const free = Game.sellerFree(me, k), g = gifts.find(x => x.res === k);
          if (free < 1 && !g) return '';
          return `<div class="al-res"><span style="color:${RES[k].color}">${RES[k].name}${g ? `: поставляем ${g.n}` : ''}</span>
            ${free >= 1 ? `<button class="btn btn-sm" data-algive="res" data-k="${k}" data-to="${t}">+1</button>` : ''}
            ${g ? `<button class="btn btn-sm" data-algive="stopres" data-k="${k}" data-to="${t}">−1</button>` : ''}</div>`;
        }).join('') || '<div class="pc-empty">У нас нет излишков ресурсов.</div>';
        const myP = this.P();
        help = `<div class="pc-sec" style="margin-top:10px"><span>Помощь союзнику</span></div>
          <div class="al-help">
            <button class="btn btn-sm" data-algive="divs" data-n="1" data-to="${t}" ${myP.divs < 1 ? 'disabled' : ''}>Передать 1 дивизию</button>
            <button class="btn btn-sm" data-algive="divs" data-n="5" data-to="${t}" ${myP.divs < 5 ? 'disabled' : ''}>Передать 5 дивизий</button>
            <button class="btn btn-sm" data-algive="pp" data-n="10" data-to="${t}" ${myP.pp < 10 ? 'disabled' : ''}>Передать 10 ПВ</button>
            <button class="btn btn-sm" data-algive="pp" data-n="50" data-to="${t}" ${myP.pp < 50 ? 'disabled' : ''}>Передать 50 ПВ</button>
          </div>
          <div class="pc-note">Дивизии уходят из нашего резерва в резерв союзника. Ресурсы — бесплатные поставки из наших излишков, каждый день.</div>
          ${resBtns}`;
      }
      return `<div class="al-col" style="--pc:${D.color}">
        <div class="al-head"><div class="al-portrait">${Portraits.html(Game.leaderOf(t), 'ptr-fill')}</div>
          <div><b>${U.esc(D.name)}${t === me ? ' <small>мы</small>' : ''}</b><span>${U.esc(Game.leaderTitle(t))} ${U.esc(Game.leaderOf(t))}${P.player && t !== me ? ' · игрок ' + U.esc(P.player) : ''}</span></div></div>
        <div class="al-stats">
          <div><span>ПВ</span><b>${U.fmt(P.pp, 0)}</b></div>
          <div><span>Заводы</span><b>${Game.playerFactories(t)}</b></div>
          <div><span>Дивизии</span><b>${U.fmt(Game.totalDivs(t), 0)}</b></div>
          <div><span>Регионы</span><b>${Game.lands(t).length}</b></div>
        </div>
        <div class="al-res-row">${res}</div>
        <div class="al-war">${enemies.length ? 'Воюет: ' + enemies.map(U.esc).join(', ') : 'Войн нет'}</div>
        <div class="pc-sec"><span>Армии</span></div><div class="pc-list al-list">${armies}</div>
        ${help}
      </div>`;
    }).join('');
    const share = team.reduce((s, t) => s + Game.industryShare(t), 0);
    this.alEl.innerHTML = `<div class="pc-head"><svg><use href="#i-flag"/></svg><div><div class="mh-k">Военный союз</div><h2>${team.map(t => U.esc(POWERS[t].name)).join(' + ')}</h2></div>
      <div class="tr-sum"><span>Общая промышленность <b class="${share >= CFG.VICTORY_SHARE ? 'pos' : ''}">${U.pct(share)}</b></span><em>победа союза — ${U.pct(CFG.VICTORY_SHARE)}</em></div></div>
      <div class="al-cols">${cols}</div>`;
  },

  onAllyClick(e) {
    const el = e.target.closest('[data-algo],[data-algive]');
    if (!el || el.disabled) return;
    Sound.play('click');
    if (el.dataset.algo) {
      const id = el.dataset.algo;
      const m = this.modals.find(x => x.key === 'ally');
      if (m) this.closeModal(m);
      MapView.focus(id);
      this.select(id);
      return;
    }
    const to = el.dataset.to, k = el.dataset.algive;
    const done = res => { this.result(res); this.renderAlliance(true); };
    if (k === 'divs') Act.call('giveDivs', to, +el.dataset.n).then(done);
    else if (k === 'pp') Act.call('givePP', to, +el.dataset.n).then(done);
    else if (k === 'res') Act.call('giveRes', to, el.dataset.k, 1).then(done);
    else if (k === 'stopres') Act.call('stopGiveRes', to, el.dataset.k).then(done);
  },

  // Кнопка «Союз» вверху видна, только когда союз есть
  updateAllyButton() {
    const b = document.getElementById('tb-ally');
    if (!b || !Game.S) return;
    const on = Game.alliesOfPower(Game.me).length > 0;
    b.classList.toggle('hidden', !on);
  }
});
