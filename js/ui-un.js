'use strict';
/* ============================================================
   ОКНО ООН: голосования, Совет Безопасности, организации
   ============================================================ */

Object.assign(UI, {
  unTab: 'votes',
  unType: 'condemn',
  unTarget: null,

  openUN(tab) {
    if (tab) this.unTab = tab;
    this.unSigV = null;
    this.openModal({
      key: 'un', cls: 'm-un', html: '<div class="un"></div>',
      onOpen: el => {
        this.unEl = el.querySelector('.un');
        this.unEl.addEventListener('click', e => this.onUNClick(e));
        this.unEl.addEventListener('change', e => this.onUNChange(e));
        this.renderUN(true);
      },
      onClose: () => { this.unEl = null; }
    });
  },

  voteLabel(v) { return { yes: 'за', no: 'против', abs: 'воздерж.', veto: 'ВЕТО' }[v] || '—'; },
  orgName(id) { const c = Game.c(id); return c ? c.name : id; },

  // Кого можно сделать целью резолюции данного типа
  unTargets(type) {
    const out = [];
    for (const t of Game.alive()) if (t !== Game.me) out.push({ id: t, name: POWERS[t].name + ' (держава)' });
    Game.eachCountry(c => {
      if (c.ctrl !== c.id || c.inert || !Geo.meta[c.id]) return;
      if (type === 'sanctions' || (type === 'peace' && Game.peacePairs(c.id).length)) out.push({ id: c.id, name: c.name });
    });
    return out.filter(o => !Game.canPropose(type, o.id) || ['Нужно 25 ПВ'].includes(Game.canPropose(type, o.id)) || /Новую резолюцию/.test(Game.canPropose(type, o.id)));
  },

  unSig() {
    const U0 = Game.un();
    return JSON.stringify([this.unTab, this.unType, this.unTarget, U0.active.map(r => [r.id, Object.keys(r.votes).length, r.votes[Game.homeOf(Game.me)]]),
      U0.history.length, Game.S.orgs, U0.applying, Math.round(this.P().pp / 5), (U0.cool || {})[Game.me]]);
  },

  renderUN(force) {
    if (!this.unEl) return;
    const sig = this.unSig();
    if (!force && sig === this.unSigV) return;
    this.unSigV = sig;
    const U0 = Game.un(), me = Game.me, home = Game.homeOf(me), S = Game.S;
    const tabs = [['votes', 'Голосования'], ['sc', 'Совет Безопасности'], ['orgs', 'Организации']]
      .map(([k, n]) => `<button class="un-tab ${this.unTab === k ? 'on' : ''}" data-untab="${k}">${n}${k === 'votes' && U0.active.length ? ` <em>${U0.active.length}</em>` : ''}</button>`).join('');
    let body = '';

    if (this.unTab === 'votes') {
      const act = U0.active.map(r => {
        const T = UN_RES[r.type], t = Game.tally(r), my = r.votes[home];
        const left = Math.max(0, r.end - S.day);
        return `<div class="un-res">
          <div class="un-res-top"><svg><use href="#${T.icon}"/></svg><b>${T.name}: ${U.esc(r.tName)}</b><span class="un-body">${r.body === 'SC' ? 'Совбез' : 'Генассамблея'}</span></div>
          <div class="un-res-sub">Внёс: ${U.esc(r.by)} · итог через ${U.days(left)} · наш голос: <b>${this.voteLabel(my)}</b></div>
          <div class="un-bar"><i class="y" style="flex:${t.yes}"></i><i class="a" style="flex:${t.abs}"></i><i class="n" style="flex:${t.no}"></i></div>
          <div class="un-res-sub">за ${t.yes} · воздержались ${t.abs} · против ${t.no}${t.vetoBy.length ? ' · <b class="neg">вето: ' + t.vetoBy.map(id => this.orgName(id)).join(', ') + '</b>' : ''}${r.body === 'SC' ? ' · нужно 9 «за» и ни одного вето' : ''}</div>
        </div>`;
      }).join('') || '<div class="pc-empty">Сейчас голосований нет.</div>';
      const hist = U0.history.map(h => `<div class="un-hist ${h.result.pass ? 'ok' : 'no'}"><b>${h.result.pass ? 'Принята' : 'Отклонена'}</b>
        <span>${UN_RES[h.type].name}: ${U.esc(h.tName)}<em>${U.fmtDate(S.date - (S.day - h.day) * DAY_MS)} · за ${h.result.yes}, против ${h.result.no}${h.result.vetoBy.length ? ', вето: ' + h.result.vetoBy.map(id => this.orgName(id)).join(', ') : ''}</em></span></div>`).join('')
        || '<div class="pc-empty">Пока ни одной резолюции.</div>';
      const targets = this.unTargets(this.unType);
      if (!targets.some(t => t.id === this.unTarget)) this.unTarget = targets[0] ? targets[0].id : null;
      const why = this.unTarget ? Game.canPropose(this.unType, this.unTarget) : 'Нет подходящей цели';
      body = `<div class="pc-cols"><div class="pc-col">
          <div class="pc-sec"><span>Идут голосования</span></div><div class="pc-list">${act}</div>
          <div class="pc-sec" style="margin-top:12px"><span>Внести проект резолюции</span></div>
          <div class="un-prop">
            <select data-unsel="type">${Object.entries(UN_RES).map(([k, T]) => `<option value="${k}" ${k === this.unType ? 'selected' : ''}>${T.name} (${T.body === 'SC' ? 'Совбез' : 'Генассамблея'})</option>`).join('')}</select>
            <select data-unsel="target">${targets.map(t => `<option value="${t.id}" ${t.id === this.unTarget ? 'selected' : ''}>${U.esc(t.name)}</option>`).join('') || '<option>—</option>'}</select>
            <div class="pc-note">${UN_RES[this.unType].desc}</div>
            <button class="btn btn-gold" data-unprop ${why ? 'disabled' : ''}>Внести · 25 ПВ</button>
            ${why ? `<div class="pc-why">${U.esc(why)}</div>` : ''}
          </div></div>
        <div class="pc-col"><div class="pc-sec"><span>История</span></div><div class="pc-list">${hist}</div></div></div>`;
    } else if (this.unTab === 'sc') {
      const row = (id, perm) => {
        const c = Game.c(id), tag = Game.voterPower(id);
        const gone = !c || (c.ctrl !== c.id && !tag);
        return `<div class="tr-row ${gone ? 'blocked' : ''}"><span class="tr-nm">${U.esc(c ? c.name : id)}${perm ? '<span class="tr-tag pw">вето</span>' : ''}${tag ? '<span class="tr-tag al">игрок</span>' : ''}
          <em>${gone ? 'место пустует: страна оккупирована' : (FACTIONS[c.faction] || FACTIONS.NEU).name}</em></span></div>`;
      };
      body = `<div class="pc-cols"><div class="pc-col"><div class="pc-sec"><span>Постоянные члены</span></div><div class="pc-list">${UN_P5.map(id => row(id, true)).join('')}</div>
          <div class="pc-note">Любой постоянный член может заблокировать решение Совбеза вето. Если страну захватили, её место пустует.</div></div>
        <div class="pc-col"><div class="pc-sec"><span>Непостоянные члены (2018)</span></div><div class="pc-list">${UN_SC10.map(id => row(id, false)).join('')}</div></div></div>`;
    } else {
      const cards = Object.entries(ORGS).map(([k, o]) => {
        const members = (S.orgs[k] || []).filter(id => { const c = Game.c(id); return c && (c.ctrl === c.id || Game.voterPower(id)); });
        const inn = Game.inOrg(k, me), applying = (U0.applying || {})[me] === k;
        const why = inn ? null : Game.canJoinOrg(k);
        const btn = inn ? `<button class="btn btn-sm btn-danger" data-unleave="${k}">Выйти</button>`
          : applying ? `<span class="un-applying">Переговоры: ещё ${U.days(Math.max(0, U0.applyDay[me] - S.day))}</span>`
          : `<button class="btn btn-sm" data-unjoin="${k}" ${why ? `disabled data-tip="${U.esc(why)}"` : ''}>Вступить · 40 ПВ</button>`;
        return `<div class="un-org" style="--oc:${o.color}"><div class="un-org-top"><b>${o.short}</b><span>${o.name !== o.short ? o.name : ""}</span>${inn ? '<span class="tr-tag al">мы участник</span>' : ''}${btn}</div>
          <div class="un-org-fx">${o.fx}</div>
          <div class="un-org-mem">${members.length} участников: ${members.slice(0, 18).map(id => U.esc(this.orgName(id))).join(', ')}${members.length > 18 ? '…' : ''}</div>
          ${!inn && why && !applying ? `<div class="pc-why" style="text-align:left">${U.esc(why)}</div>` : ''}</div>`;
      }).join('');
      const blocs = ['WEST', 'COM', 'GUAM'].map(f => `<span>${FACTIONS[f].name}: ${Game.list(c => c.faction === f && c.ctrl === c.id).length}</span>`).join(' · ');
      body = `<div class="un-orgs">${cards}</div><div class="pc-note">Военные блоки — это фракции игры: ${blocs}.</div>`;
    }

    this.unEl.innerHTML = `<div class="pc-head"><svg><use href="#i-globe"/></svg><div><div class="mh-k">Международные отношения</div><h2>ООН и организации</h2></div></div>
      <div class="un-tabs">${tabs}</div>${body}`;
  },

  onUNClick(e) {
    const el = e.target.closest('[data-untab],[data-unprop],[data-unjoin],[data-unleave]');
    if (!el || el.disabled) return;
    Sound.play('click');
    const done = res => { this.result(res); this.renderUN(true); };
    if (el.dataset.untab) { this.unTab = el.dataset.untab; this.renderUN(true); }
    else if (el.hasAttribute('data-unprop')) Act.call('proposeResolution', this.unType, this.unTarget).then(done);
    else if (el.dataset.unjoin) Act.call('joinOrg', el.dataset.unjoin).then(done);
    else if (el.dataset.unleave) Act.call('leaveOrg', el.dataset.unleave).then(done);
  },
  onUNChange(e) {
    const el = e.target.closest('[data-unsel]');
    if (!el) return;
    if (el.dataset.unsel === 'type') { this.unType = el.value; this.unTarget = null; }
    else this.unTarget = el.value;
    this.renderUN(true);
  },

  updateUNBadge() {
    const el = document.getElementById('badge-un');
    if (!el || !Game.S || !this.P()) return;
    const n = Game.un().active.length;
    el.classList.toggle('hidden', !n);
    el.textContent = n;
  }
});
