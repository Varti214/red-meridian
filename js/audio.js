'use strict';
/* ============================================================
   ЗВУК: все звуки синтезируются Web Audio API на лету —
   никаких аудиофайлов, которые могли бы не загрузиться.
   ============================================================ */

const Sound = {
  ctx: null,
  master: null,
  enabled: true,

  init() {
    const s = U.storage.get(CFG.SETTINGS_KEY);
    try { if (s) this.enabled = JSON.parse(s).sound !== false; } catch (e) { /* настройки повреждены — оставляем по умолчанию */ }
  },

  // Браузеры разрешают звук только после действия пользователя, поэтому контекст создаём лениво
  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      return true;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    try {
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.35;
      this.master.connect(this.ctx.destination);
      return true;
    } catch (e) {
      return false;
    }
  },

  toggle() {
    this.enabled = !this.enabled;
    U.storage.set(CFG.SETTINGS_KEY, JSON.stringify({ sound: this.enabled }));
    return this.enabled;
  },

  tone(freq, dur, type = 'sine', vol = 0.3, delay = 0, slideTo = null) {
    const c = this.ctx, t = c.currentTime + delay;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  },

  noise(dur, vol = 0.4, filterFreq = 800, delay = 0) {
    const c = this.ctx, t = c.currentTime + delay;
    const len = Math.floor(c.sampleRate * dur);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
    const src = c.createBufferSource();
    src.buffer = buf;
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = filterFreq;
    const g = c.createGain();
    g.gain.value = vol;
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
  },

  play(name) {
    if (!this.enabled || !this.ensure()) return;
    try {
      switch (name) {
        case 'click': this.tone(880, 0.05, 'square', 0.04); break;
        case 'hover': this.tone(1400, 0.02, 'sine', 0.015); break;
        case 'open': this.tone(520, 0.08, 'triangle', 0.08); this.tone(780, 0.1, 'triangle', 0.06, 0.05); break;
        case 'error': this.tone(180, 0.18, 'sawtooth', 0.07); break;
        case 'ok': this.tone(660, 0.08, 'triangle', 0.08); this.tone(990, 0.12, 'triangle', 0.07, 0.07); break;
        case 'event': this.tone(392, 0.25, 'triangle', 0.1); this.tone(523, 0.25, 'triangle', 0.08, 0.12); this.tone(659, 0.4, 'triangle', 0.07, 0.24); break;
        case 'alert': this.tone(740, 0.15, 'square', 0.06); this.tone(740, 0.15, 'square', 0.06, 0.25); break;
        case 'battle':
          this.noise(0.6, 0.5, 400);
          this.noise(0.4, 0.35, 900, 0.18);
          this.tone(70, 0.5, 'sine', 0.25, 0, 40);
          break;
        case 'victory': [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.35, 'triangle', 0.08, i * 0.12)); break;
        case 'defeat': [392, 330, 262].forEach((f, i) => this.tone(f, 0.45, 'sawtooth', 0.05, i * 0.2)); break;
        case 'launch': this.tone(200, 1.6, 'sawtooth', 0.05, 0, 900); this.noise(1.6, 0.15, 2000); break;
        case 'nuke':
          this.noise(3.5, 0.9, 220);
          this.noise(1.2, 0.5, 1800);
          this.tone(45, 3.2, 'sine', 0.5, 0, 25);
          break;
      }
    } catch (e) { /* звук — не критичная часть, ошибки игнорируем */ }
  }
};
