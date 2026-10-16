// One tone, transformed by every layer of the network, synthesized live with the Web Audio API.
//
//   input      a pure sine
//   embedding  harmonics bloom
//   hidden     wind moves through it (and the meadow rustles under the cursor)
//   weights    frequency modulation and a resonant filter
//   attention  echoes of what came before
//   output     it resolves into a chord
//
// Parameters are interpolated from the camera's continuous position, so the sound morphs during each flight.
// Nodes can be played (pluck), and the analyser feeds the oscilloscope and spectrum ring.
// Off by default; the choice is remembered.

const F0 = 146.83; // D3
const SCALE = [0, 2, 4, 7, 9]; // major pentatonic
const STORAGE_KEY = 'sound';

const LAYER_PARAMS = {
  fund:   [1.0, 0.8, 0.65, 0.55, 0.5, 0.45],
  harm:   [0.0, 0.85, 0.5, 0.45, 0.4, 0.3],
  fm:     [0.0, 0.2, 0.1, 0.9, 0.35, 0.08],
  cutoff: [1400, 2600, 1800, 3200, 2200, 3000],
  q:      [0.7, 1.0, 0.8, 7.0, 2.0, 1.0],
  air:    [0.0, 0.03, 0.55, 0.15, 0.15, 0.05],
  echo:   [0.0, 0.08, 0.15, 0.2, 0.6, 0.25],
  chord:  [0.0, 0.0, 0.0, 0.0, 0.25, 1.0],
  trem:   [0.0, 0.06, 0.12, 0.3, 0.12, 0.03],
};
const LAST = LAYER_PARAMS.fund.length - 1;
const HARMONICS = [[2, 0.5], [3, 0.32], [4, 0.22], [5, 0.16]];
const CHORD = [[1.5, 0.45], [2.5, 0.3], [4, 0.2]];

function paramsAt(f) {
  f = Math.min(LAST, Math.max(0, f));
  const i = Math.min(LAST - 1, Math.floor(f));
  const x = f - i;
  const t = x * x * (3 - 2 * x);
  const out = {};
  for (const [k, v] of Object.entries(LAYER_PARAMS)) out[k] = v[i] + (v[i + 1] - v[i]) * t;
  return out;
}

function impulse(ctx, seconds, decay) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return buf;
}

export class SoundScape {
  constructor() {
    this.ctx = null;
    this.enabled = false;
    try { this.enabled = localStorage.getItem(STORAGE_KEY) === 'on'; } catch { /* storage unavailable */ }
    this.focus = 0;
    this.lastFocus = NaN;
    this.lastPluck = 0;
  }

  _ensure() {
    if (this.ctx) return;
    const ctx = (this.ctx = new (window.AudioContext || window.webkitAudioContext)());
    const osc = (type, freq) => { const o = ctx.createOscillator(); o.type = type; o.frequency.value = freq; o.start(); return o; };
    const gain = (v) => { const g = ctx.createGain(); g.gain.value = v; return g; };
    const filter = (type, freq, q = 0.7) => { const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q; return f; };

    // output chain
    this.master = gain(0);
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -20;
    comp.ratio.value = 4;
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.75;
    this.master.connect(comp).connect(this.analyser).connect(ctx.destination);
    this.timeBuf = new Float32Array(this.analyser.fftSize);
    this.freqBuf = new Uint8Array(this.analyser.frequencyBinCount);

    // space
    this.verb = gain(0.28);
    const conv = ctx.createConvolver();
    conv.buffer = impulse(ctx, 3, 2.8);
    this.verb.connect(conv).connect(this.master);

    // echo (attention)
    this.echoIn = gain(0);
    const delay = ctx.createDelay(2);
    delay.delayTime.value = 0.36;
    const fb = gain(0.5);
    const tone = filter('lowpass', 2400);
    this.echoIn.connect(delay).connect(tone).connect(fb).connect(delay);
    tone.connect(this.master);
    tone.connect(this.verb);

    // the tone
    this.voiceBus = gain(0.085);
    this.filter = filter('lowpass', 1400);
    this.trem = gain(1);
    const tremLfo = osc('sine', 3.1);
    this.tremDepth = gain(0);
    tremLfo.connect(this.tremDepth).connect(this.trem.gain);
    this.voiceBus.connect(this.filter).connect(this.trem);
    this.trem.connect(this.master);
    this.trem.connect(this.echoIn);
    this.trem.connect(this.verb);

    const carrier = osc('sine', F0);
    this.fund = gain(1);
    carrier.connect(this.fund).connect(this.voiceBus);
    const mod = osc('sine', F0 * 2);
    this.fmDepth = gain(0);
    mod.connect(this.fmDepth).connect(carrier.frequency);
    this.harmonics = HARMONICS.map(([ratio]) => { const g = gain(0); osc('sine', F0 * ratio).connect(g).connect(this.voiceBus); return g; });
    this.chord = CHORD.map(([ratio]) => {
      const g = gain(0);
      const o = osc('sine', F0 * ratio);
      o.detune.value = 4;
      o.connect(g).connect(this.voiceBus);
      return g;
    });

    // noise for wind and rustle
    const nb = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
    const nd = nb.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    const noise = (offset) => { const s = ctx.createBufferSource(); s.buffer = nb; s.loop = true; s.start(0, offset); return s; };

    // wind (hidden layer)
    const windBand = filter('bandpass', 900, 0.8);
    const windLfo = osc('sine', 0.07);
    const windSweep = gain(450);
    windLfo.connect(windSweep).connect(windBand.frequency);
    this.air = gain(0);
    noise(0).connect(windBand).connect(this.air);
    this.air.connect(this.master);
    this.air.connect(this.verb);

    // rustle, driven by dragging over the meadow
    this.rustle = gain(0);
    noise(1.3).connect(filter('highpass', 2200)).connect(filter('lowpass', 7000)).connect(this.rustle);
    this.rustle.connect(this.master);
    this.rustle.connect(this.verb);

    // plucked nodes
    this.pluckBus = gain(1);
    this.pluckBus.connect(this.master);
    this.pluckBus.connect(this.echoIn);
    this.pluckBus.connect(this.verb);
  }

  get live() {
    return this.enabled && this.ctx && this.ctx.state === 'running';
  }

  async setEnabled(on) {
    this.enabled = on;
    try { localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off'); } catch { /* storage unavailable */ }
    if (on) {
      await this._start();
    } else if (this.ctx) {
      const now = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(now);
      this.master.gain.setTargetAtTime(0, now, 0.12);
      clearTimeout(this.suspendTimer);
      this.suspendTimer = setTimeout(() => { if (!this.enabled) this.ctx.suspend(); }, 700);
    }
  }

  // A remembered "on" still needs a user gesture before audio may start.
  async unlock() {
    if (this.enabled && !this.live) await this._start();
  }

  async _start() {
    this._ensure();
    clearTimeout(this.suspendTimer);
    await this.ctx.resume();
    this.lastFocus = NaN;
    this.setFocus(this.focus);
    const now = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setTargetAtTime(0.9, now, 0.5);
  }

  // f: continuous layer position (0 = input … 5 = output)
  setFocus(f) {
    this.focus = f;
    if (!this.live || Math.abs(f - this.lastFocus) < 0.002) return;
    this.lastFocus = f;
    const p = paramsAt(f);
    const now = this.ctx.currentTime, tc = 0.08;
    const set = (param, v) => param.setTargetAtTime(v, now, tc);
    set(this.fund.gain, p.fund);
    this.harmonics.forEach((g, i) => set(g.gain, p.harm * HARMONICS[i][1]));
    this.chord.forEach((g, i) => set(g.gain, p.chord * CHORD[i][1]));
    set(this.fmDepth.gain, p.fm * F0);
    set(this.filter.frequency, p.cutoff);
    set(this.filter.Q, p.q);
    set(this.air.gain, p.air * 0.2);
    set(this.echoIn.gain, p.echo);
    set(this.tremDepth.gain, p.trem * 0.5);
  }

  // Play a node. `degree` walks up the pentatonic scale; the timbre comes from the layer it sits in.
  pluck(layer, degree, velocity = 0.5) {
    if (!this.live) return;
    const ctx = this.ctx, now = ctx.currentTime;
    if (now - this.lastPluck < 0.04) return;
    this.lastPluck = now;
    const p = paramsAt(layer);
    const d = Math.max(0, Math.round(degree));
    const freq = F0 * 2 * Math.pow(2, Math.floor(d / SCALE.length) + SCALE[d % SCALE.length] / 12);

    const out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, now);
    out.gain.exponentialRampToValueAtTime(0.1 * velocity, now + 0.006);
    out.gain.exponentialRampToValueAtTime(0.0001, now + 1.8);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = p.cutoff * 1.6;
    lp.Q.value = Math.min(p.q, 3);
    lp.connect(out).connect(this.pluckBus);

    const body = ctx.createOscillator();
    body.frequency.value = freq;
    body.connect(lp);
    const over = ctx.createOscillator();
    over.frequency.value = freq * 2;
    const overGain = ctx.createGain();
    overGain.gain.value = 0.1 + p.harm * 0.3;
    over.connect(overGain).connect(lp);
    // FM shimmer that decays quickly, stronger in the "weights" layer
    const mod = ctx.createOscillator();
    mod.frequency.value = freq * 1.4;
    const modGain = ctx.createGain();
    modGain.gain.setValueAtTime(freq * (0.2 + p.fm * 1.5), now);
    modGain.gain.exponentialRampToValueAtTime(1, now + 0.4);
    mod.connect(modGain).connect(body.frequency);

    [body, over, mod].forEach((o) => { o.start(now); o.stop(now + 1.9); });
  }

  // amount: 0..1, how hard the meadow is being brushed right now
  setRustle(amount) {
    if (!this.live) return;
    this.rustle.gain.setTargetAtTime(Math.min(1, amount) * 0.16, this.ctx.currentTime, 0.06);
  }

  // Overwrite the visual signal with the real output. Returns false when sound is off.
  sample(levels) {
    if (!this.live || this.master.gain.value < 0.01) return false;
    const a = this.analyser, buf = this.timeBuf, wave = levels.wave;
    a.getFloatTimeDomainData(buf);
    // trigger on a rising zero crossing so the oscilloscope stands still
    let start = 0;
    for (let i = 1; i < buf.length - wave.length; i++) {
      if (buf[i - 1] < 0 && buf[i] >= 0) { start = i; break; }
    }
    let peak = 0;
    for (let i = 0; i < wave.length; i++) peak = Math.max(peak, Math.abs(buf[start + i]));
    const norm = 0.32 / Math.max(peak, 0.04);
    for (let i = 0; i < wave.length; i++) wave[i] = buf[start + i] * norm;

    a.getByteFrequencyData(this.freqBuf);
    const f = this.freqBuf, spec = levels.spectrum, n = spec.length;
    for (let b = 0; b < n; b++) {
      const i0 = Math.floor(3 * Math.pow(100, b / n));
      const i1 = Math.max(i0 + 1, Math.floor(3 * Math.pow(100, (b + 1) / n)));
      let m = 0;
      for (let i = i0; i < i1; i++) m = Math.max(m, f[i]);
      spec[b] += (m / 255 - spec[b]) * 0.4;
    }
    let low = 0, mid = 0;
    for (let i = 3; i < 14; i++) low += f[i];
    for (let i = 14; i < 120; i++) mid += f[i];
    levels.low = 0.08 + (low / 11 / 255) * 0.3;
    levels.mid = 0.1 + (mid / 106 / 255) * 0.5;
    return true;
  }
}
