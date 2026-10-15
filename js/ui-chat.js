'use strict';
/* ============================================================
   ЧАТ И МЕТКИ НА КАРТЕ (сетевая игра).
   Enter — написать сообщение, Tab в поле — «всем» / «союзнику».
   Alt + клик по региону (или кнопка «Метка») — поставить метку:
   «Бей сюда», «Держу оборону», «Внимание». Метки видят союзники.
   ============================================================ */

const PING_KINDS = {
  attack: { label: 'Бей сюда', rgb: '255,90,60', icon: 'i-swords' },
  defend: { label: 'Держу оборону', rgb: '90,170,255', icon: 'i-shield' },
  alert: { label: 'Внимание', rgb: '255,210,70', icon: 'i-eye' }
};

Object.assign(UI, {
  chatTo: 'all',
  chatLog: [],
  mouse: { x: 0, y: 0 },

  initChat() {
    if (this.chatReady) return;
    this.chatReady = true;
    const box = document.createElement('div');
    box.id = 'chat';
    box.className = 'hidden';
    box.innerHTML = `<div class="ch-list"></div>
      <div class="ch-bar"><button class="ch-to" data-chto data-tip="Кому: всем игрокам или только союзнику (Tab)"></button>
        <input class="ch-in" maxlength="200" placeholder="Сообщение… (Enter)">
        <button class="ch-ping" data-chping data-tip="Поставить метку на карте: кликните кнопку, затем регион (или Alt + клик)"><svg><use href="#i-flag"/></svg></button></div>`;
    document.body.appendChild(box);
    this.chatEl = box;
    const input = box.querySelector('.ch-in');
    input.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Enter') { this.sendChat(input.value); input.value = ''; input.blur(); }
      else if (e.key === 'Escape') input.blur();
      else if (e.key === 'Tab') { e.preventDefault(); this.toggleChatTo(); }
    });
    input.addEventListener('focus', () => box.classList.add('typing'));
    input.addEventListener('blur', () => box.classList.remove('typing'));
    box.querySelector('[data-chto]').addEventListener('click', () => this.toggleChatTo());
    box.querySelector('[data-chping]').addEventListener('click', () => { this.pingMode = !this.pingMode; box.classList.toggle('pinging', this.pingMode); if (this.pingMode) this.toast('Кликните по региону, чтобы поставить метку', 'info'); });
    document.addEventListener('mousemove', e => { this.mouse.x = e.clientX; this.mouse.y = e.clientY; }, { passive: true });
    document.addEventListener('keydown', e => { if (e.key === 'Alt') this.altDown = true; });
    document.addEventListener('keyup', e => { if (e.key === 'Alt') this.altDown = false; });
    window.addEventListener('blur', () => { this.altDown = false; });
    // Enter вне полей ввода открывает чат
    document.addEventListener('keydown', e => {
      if (e.key !== 'Enter' || !Net.mp || !this.started || this.modals.length) return;
      if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
      e.preventDefault();
      input.focus();
    });
    // Alt + клик / режим метки: перехватываем клик по карте
    const onClick = MapView.onClick.bind(MapView);
    MapView.onClick = id => {
      if (Net.mp && id && (this.pingMode || this.altDown)) { this.pingMode = false; box.classList.remove('pinging'); return this.openPingMenu(id); }
      return onClick(id);
    };
    this.updateChatTo();
  },

  showChat() {
    this.initChat();
    this.chatEl.classList.toggle('hidden', !Net.mp);
  },
  hasAlly() { return Game.S && Game.alliesOfPower && Game.alliesOfPower(Game.me).length > 0; },
  toggleChatTo() { this.chatTo = this.chatTo === 'all' && this.hasAlly() ? 'ally' : 'all'; this.updateChatTo(); },
  updateChatTo() {
    if (!this.chatEl) return;
    const b = this.chatEl.querySelector('[data-chto]');
    b.textContent = this.chatTo === 'ally' ? 'Союзнику' : 'Всем';
    b.classList.toggle('ally', this.chatTo === 'ally');
  },
  sendChat(text) {
    text = String(text || '').trim();
    if (!text) return;
    if (!Net.send('chat', { text, to: this.chatTo })) this.toast('Нет связи с сервером', 'err');
  },
  onChat(m) {
    this.chatLog.push(m);
    if (this.chatLog.length > 40) this.chatLog.shift();
    this.renderChat();
    if (m.power !== Game.me) Sound.play('click');
  },
  renderChat() {
    if (!this.chatEl) return;
    const list = this.chatEl.querySelector('.ch-list');
    const now = Date.now();
    list.innerHTML = this.chatLog.slice(-8).map(m => {
      const c = POWERS[m.power] ? POWERS[m.power].color : '#ccc';
      const old = now - m.t > 25000 ? ' old' : '';
      return `<div class="ch-msg${old}${m.to === 'ally' ? ' ally' : ''}"><b style="color:${c}">${U.esc(m.from)}${m.to === 'ally' ? ' (союзу)' : ''}:</b> ${U.esc(m.text)}</div>`;
    }).join('');
    clearTimeout(this.chatFade);
    this.chatFade = setTimeout(() => this.renderChat(), 26000);
  },

  /* --- Метки --- */
  openPingMenu(id) {
    document.querySelectorAll('.ping-menu').forEach(x => x.remove());
    const r = Game.r(id);
    const m = document.createElement('div');
    m.className = 'ping-menu';
    m.style.left = Math.min(window.innerWidth - 190, this.mouse.x + 6) + 'px';
    m.style.top = Math.min(window.innerHeight - 150, this.mouse.y + 6) + 'px';
    m.innerHTML = `<div class="pm-t">${U.esc(r ? r.name : id)}</div>` + Object.entries(PING_KINDS).map(([k, p]) =>
      `<button data-pk="${k}" style="--pc:rgb(${p.rgb})"><svg><use href="#${p.icon}"/></svg>${p.label}</button>`).join('');
    document.body.appendChild(m);
    const close = () => { m.remove(); document.removeEventListener('mousedown', out, true); };
    const out = e => { if (!m.contains(e.target)) close(); };
    setTimeout(() => document.addEventListener('mousedown', out, true), 0);
    m.addEventListener('click', e => {
      const b = e.target.closest('[data-pk]');
      if (!b) return;
      Net.send('ping', { region: id, kind: b.dataset.pk });
      close();
    });
  },
  onPing(p) {
    const K = PING_KINDS[p.kind] || PING_KINDS.alert, r = Game.r(p.region);
    if (!r) return;
    MapView.fxPing(p.region, K.rgb, `${p.from}: ${K.label}`);
    Sound.play('alert');
    this.onChat({ from: p.from, power: p.power, text: `📍 ${K.label} — ${r.name}`, to: 'ally', t: Date.now() });
  }
});
