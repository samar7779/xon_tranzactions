/**
 * Login sahifasi uchun Web Audio sound effects.
 * KIRISH bosish, scan, success momentlarida tovush chiqaradi.
 * Brauzer audio context'ni faqat user-interaction'dan keyin yaratadi.
 */

let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const AC = (window.AudioContext || (window as any).webkitAudioContext);
    if (!AC) return null;
    ctx = new AC();
  }
  // Suspended (autoplay policy) — resume on demand
  if (ctx.state === 'suspended') {
    ctx.resume().catch(() => {});
  }
  return ctx;
}

/** Mechanical key click — qisqa, past tonli */
export function playClick() {
  const c = getCtx();
  if (!c) return;
  const buf = c.createBuffer(1, c.sampleRate * 0.05, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (c.sampleRate * 0.008));
  }
  const src = c.createBufferSource();
  src.buffer = buf;
  const gain = c.createGain();
  gain.gain.value = 0.25;
  src.connect(gain).connect(c.destination);
  src.start();
}

/** Security scan — sawtooth sweep, past'dan baland'ga */
export function playScan() {
  const c = getCtx();
  if (!c) return;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(200, c.currentTime);
  osc.frequency.exponentialRampToValueAtTime(800, c.currentTime + 1.0);
  gain.gain.setValueAtTime(0.04, c.currentTime);
  gain.gain.linearRampToValueAtTime(0.12, c.currentTime + 0.4);
  gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 1.0);
  const filter = c.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 1500;
  osc.connect(filter).connect(gain).connect(c.destination);
  osc.start();
  osc.stop(c.currentTime + 1.0);
}

/** Access granted — major chord (C-E-G) */
export function playSuccess() {
  const c = getCtx();
  if (!c) return;
  const notes = [523.25, 659.25, 783.99]; // C5, E5, G5
  notes.forEach((freq, i) => {
    setTimeout(() => {
      const cc = getCtx();
      if (!cc) return;
      const osc = cc.createOscillator();
      const gain = cc.createGain();
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.12, cc.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, cc.currentTime + 0.6);
      osc.connect(gain).connect(cc.destination);
      osc.start();
      osc.stop(cc.currentTime + 0.6);
    }, i * 90);
  });
}

/** Subtle beep — notifikatsiya */
export function playBeep() {
  const c = getCtx();
  if (!c) return;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.frequency.value = 880;
  gain.gain.setValueAtTime(0.15, c.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.12);
  osc.connect(gain).connect(c.destination);
  osc.start();
  osc.stop(c.currentTime + 0.12);
}
