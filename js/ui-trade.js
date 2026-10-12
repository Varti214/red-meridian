'use strict';
/* ============================================================
   ОКНО «РЕСУРСЫ И ТОРГОВЛЯ»
   ============================================================ */

Object.assign(UI, {
  tradeRes: 'oil',

  resEffect(k, short) {
    const p = U.pct(TRADE.shortK[k] * short);
    return {
      oil: `наступление слабее на ${p}`,
      gas: `доход ПВ ниже на ${p}`,
      steel: `дивизии обучаются медленнее на ${p}`,
      rare: `исследования идут медленнее на ${p}`
    }[k];
  },

  openTrade(k) {
    if (k) this.tradeRes = k;
    this.tradeSigV = null;
    this.openModal({
      key: 'trade', cls: 'm-trade', html: '<div class="tr"></div>',
      onOpen: el => {
        this.trEl = el.querySelector('.tr');
        this.trEl.addEventListener('click', e => this.onTradeClick(e));
        this.renderTrade();
      },
      onClose: () => { this.trEl = null; }
    });
  },

  tradeSig() {
    const me = Game.me, b = Game.resBalance(me);
    return JSON.stringify([this.tradeRes, RES_KEYS.map(k => [b[k].prod, b[k].imp, b[k].exp, Math.round(b[k].need * 10)]), Game.contracts(),
      Math.round(this.P().pp / 5), this.P().embargo, Game.S.tension >= 75, this.P().market]);
  },

  renderTrade(force) {
    if (!this.trEl) return;
    const sig = this.tradeSig();
    if (!force && sig === this.tradeSigV) return;
    this.tradeSigV = sig;
    const me = Game.me, P = this.P(), b = Game.resBalance(me), k = this.tradeRes;
    const scroll = this.trEl.querySelector('.tr-list');
    const top = scroll ? scroll.scrollTop : 0;

    const cards = RES_KEYS.map(x => {
      const v = b[x], R0 = RES[x];
      const ok = v.short <= 0.001;
      const pct = v.need > 0 ? Math.min(100, 100 * v.have / v.need) : 100;
      return `<button class="tr-card ${x === k ? 'on' : ''} ${ok ? '' : 'short'}" data-tres="${x}" style="--rc:${R0.color}">
        <div class="tr-c-top"><svg><use href="#${R0.icon}"/></svg><span>${R0.name}</span></div>
        <div class="tr-c-val"><b>${U.fmt(v.have, 1)}</b><em>/ ${U.fmt(v.need, 1)}</em></div>
        <div class="meter"><i style="width:${pct}%;background:${ok ? R0.color : 'var(--orange)'}"></i></div>
        <div class="tr-c-sub">добыча ${v.prod}${v.imp ? ' · импорт ' + v.imp : ''}${v.exp ? ' · экспорт ' + v.exp : ''}</div>
        <div class="tr-c-fx">${ok ? (v.surplus >= 1 ? `излишек ${U.fmt(v.surplus, 1)} — на рынок` : 'хватает') : 'нехватка: ' + this.resEffect(x, v.short)}</div>
      </button>`;
    }).join('');

    const partners = Game.tradePartners(k, me).slice(0, 40).map(p => {
      const why1 = Game.canBuy(p.id, k, 1), why3 = Game.canBuy(p.id, k, Math.min(3, p.free));
      const tag = p.power ? '<span class="tr-tag pw">держава</span>' : p.ally ? '<span class="tr-tag al">союзник</span>' : '';
      return `<div class="tr-row ${p.why ? 'blocked' : ''}">
        <span class="tr-nm">${U.esc(p.name)}${tag}<em>${p.why ? U.esc(p.why) : 'свободно: ' + p.free + ' ед.'}</em></span>
        <span class="tr-price">${U.fmt(p.price, 2)} ПВ/день</span>
        <button class="btn btn-sm" data-buy="${p.id}" data-n="1" ${why1 ? `disabled data-tip="${U.esc(why1)}"` : ''}>+1</button>
        <button class="btn btn-sm" data-buy="${p.id}" data-n="3" ${why3 || p.free < 2 ? `disabled data-tip="${U.esc(why3 || 'Свободно меньше 2 ед.')}"` : ''}>+${Math.min(3, Math.max(2, p.free))}</button>
      </div>`;
    }).join('') || '<div class="pc-empty">Никто в мире не продаёт этот ресурс сверх своих нужд.</div>';

    const mine = Game.contracts().filter(t => t.buyer === me || t.seller === me);
    const nameOf = id => Game.isPower(id) ? POWERS[id].name : (Game.c(id) || { name: id }).name;
    const contracts = mine.map(t => {
      const buy = t.buyer === me;
      return `<div class="tr-row">
        <span class="tr-nm"><i class="tr-dot" style="background:${RES[t.res].color}"></i>${RES[t.res].name}: ${t.n} ед.<em>${buy ? 'продавец: ' : 'покупатель: '}${U.esc(nameOf(buy ? t.seller : t.buyer))}</em></span>
        <span class="tr-price ${buy ? 'neg' : 'pos'}">${buy ? '−' : '+'}${U.fmt(t.price * t.n, 2)} ПВ/день</span>
        ${buy ? `<button class="btn btn-sm" data-cancel="${t.id}">${t.n > 1 ? '−1' : 'Разорвать'}</button>` : ''}
      </div>`;
    }).join('') || '<div class="pc-empty">Контрактов нет.</div>';

    const others = Game.alive().filter(t => t !== me);
    const emb = others.map(t => {
      const on = !!(P.embargo || {})[t];
      const them = !!(Game.P(t).embargo || {})[me];
      return `<div class="tr-row"><span class="tr-nm">${U.esc(POWERS[t].name)}<em>${on ? 'наш блок не торгует с ними' : 'торговля открыта'}${them ? ' · против нас их эмбарго' : ''}</em></span>
        <button class="btn btn-sm ${on ? '' : 'btn-danger'}" data-emb="${t}">${on ? 'Снять эмбарго' : 'Объявить эмбарго'}</button></div>`;
    }).join('');

    const cost = mine.filter(t => t.buyer === me).reduce((s, t) => s + t.price * t.n, 0);
    const inc = mine.filter(t => t.seller === me).reduce((s, t) => s + t.price * t.n, 0);
    this.trEl.innerHTML = `
      <div class="pc-head"><svg><use href="#i-trade"/></svg><div><div class="mh-k">Экономика державы</div><h2>Ресурсы и торговля</h2></div>
        <div class="tr-sum"><span>Рынок излишков <b class="pos">+${U.fmt(P.market || 0, 2)}</b></span><span>Импорт <b class="neg">−${U.fmt(cost, 2)}</b></span>${inc ? `<span>Экспорт державам <b class="pos">+${U.fmt(inc, 2)}</b></span>` : ''}<em>ПВ в день</em></div></div>
      <div class="tr-cards">${cards}</div>
      <div class="pc-cols">
        <div class="pc-col"><div class="pc-sec"><span>Поставщики: ${RES[k].short}</span></div><div class="pc-list tr-list">${partners}</div></div>
        <div class="pc-col"><div class="pc-sec"><span>Наши контракты</span></div><div class="pc-list tr-mine">${contracts}</div>
          ${emb ? `<div class="pc-sec" style="margin-top:12px"><span>Эмбарго</span></div><div class="pc-list">${emb}</div>` : ''}
          <div class="pc-note">Ресурсы добываются в регионах: захват месторождений решает нехватку навсегда. Санкции Запада закрывают западные рынки и вдвое снижают доход с излишков.</div></div>
      </div>`;
    const sc = this.trEl.querySelector('.tr-list');
    if (sc) sc.scrollTop = top;
  },

  onTradeClick(e) {
    const el = e.target.closest('[data-tres],[data-buy],[data-cancel],[data-emb]');
    if (!el || el.disabled) return;
    Sound.play('click');
    const done = res => { this.result(res); this.renderTrade(true); };
    if (el.dataset.tres) { this.tradeRes = el.dataset.tres; this.renderTrade(true); }
    else if (el.dataset.buy) Act.call('buyRes', el.dataset.buy, this.tradeRes, +el.dataset.n).then(done);
    else if (el.dataset.cancel) Act.call('cancelTrade', el.dataset.cancel).then(done);
    else if (el.dataset.emb) Act.call('toggleEmbargo', el.dataset.emb).then(done);
  },

  // Значок на кнопке: сколько ресурсов в нехватке
  updateTradeBadge() {
    const el = document.getElementById('badge-trade');
    if (!el || !Game.S || !this.P()) return;
    const b = Game.resBalance(Game.me);
    const n = RES_KEYS.filter(k => b[k].short > 0.05).length;
    el.classList.toggle('hidden', !n);
    el.textContent = n;
  }
});
