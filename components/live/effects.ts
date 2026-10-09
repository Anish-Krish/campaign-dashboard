// Sounds (synthesised with Web Audio — no audio files) and confetti for the
// live wins. Browsers only allow audio after the person has clicked on the
// page once, so the provider unlocks the AudioContext on the first click.

let ctx: AudioContext | null = null;

export function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  return ctx;
}

export function unlockAudio() {
  const a = audio();
  if (a && a.state === "suspended") void a.resume();
}

export function audioReady() {
  return audio()?.state === "running";
}

function tone(a: AudioContext, freq: number, start: number, dur: number, opts: { type?: OscillatorType; gain?: number } = {}) {
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = opts.type ?? "triangle";
  osc.frequency.value = freq;
  const peak = opts.gain ?? 0.18;
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(peak, start + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(g).connect(a.destination);
  osc.start(start);
  osc.stop(start + dur + 0.05);
}

function noiseHit(a: AudioContext, start: number, dur = 0.25, gain = 0.25) {
  const buf = a.createBuffer(1, Math.floor(a.sampleRate * dur), a.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 3);
  const src = a.createBufferSource();
  const g = a.createGain();
  const hp = a.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 900;
  g.gain.value = gain;
  src.buffer = buf;
  src.connect(hp).connect(g).connect(a.destination);
  src.start(start);
}

const N = { C5: 523.25, E5: 659.25, G5: 783.99, A5: 880, C6: 1046.5, E6: 1318.5, G6: 1568, C7: 2093 };

// Meeting booked: a clean two-note "ding-ding".
function playMeeting(a: AudioContext) {
  const t = a.currentTime + 0.02;
  tone(a, N.G5, t, 0.5, { gain: 0.16 });
  tone(a, N.C6, t + 0.14, 0.9, { gain: 0.18 });
  tone(a, N.C7, t + 0.14, 0.6, { type: "sine", gain: 0.05 });
}

// BANT: fast fanfare up an arpeggio, a held major chord, sparkles and claps.
function playBant(a: AudioContext) {
  const t = a.currentTime + 0.02;
  [N.C5, N.E5, N.G5, N.C6].forEach((f, i) => tone(a, f, t + i * 0.09, 0.35, { type: "square", gain: 0.07 }));
  [N.C5, N.E5, N.G5, N.C6].forEach((f) => tone(a, f, t + 0.4, 1.6, { type: "sawtooth", gain: 0.045 }));
  tone(a, N.C6, t + 0.4, 1.6, { type: "triangle", gain: 0.12 });
  for (let i = 0; i < 14; i++) {
    const f = [N.C6, N.E6, N.G6, N.C7][i % 4] * (1 + (Math.random() - 0.5) * 0.01);
    tone(a, f, t + 0.45 + i * 0.07 + Math.random() * 0.03, 0.18, { type: "sine", gain: 0.05 });
  }
  for (let i = 0; i < 8; i++) noiseHit(a, t + 0.4 + i * 0.13 + Math.random() * 0.04, 0.12, 0.18);
}

// Goal hit: the BANT fanfare twice as big, with drum hits under it.
function playGoal(a: AudioContext) {
  const t = a.currentTime + 0.02;
  for (let i = 0; i < 4; i++) noiseHit(a, t + i * 0.18, 0.2, 0.3);
  setTimeout(() => playBant(a), 650);
  [N.C5, N.G5, N.C6, N.E6].forEach((f, i) => tone(a, f, t + 0.75 + i * 0.12, 2.2, { type: "triangle", gain: 0.08 }));
}

// Chat message: a soft pop.
function playChat(a: AudioContext) {
  const t = a.currentTime + 0.01;
  tone(a, N.A5, t, 0.12, { type: "sine", gain: 0.08 });
}

export function playFor(kind: string) {
  const a = audio();
  if (!a || a.state !== "running") return;
  if (kind === "meeting") playMeeting(a);
  else if (kind === "bant") playBant(a);
  else if (kind === "goal") playGoal(a);
  else if (kind === "chat") playChat(a);
}

// --- Confetti ----------------------------------------------------------------------

const COLORS = ["#22a55b", "#5fd08f", "#5598e7", "#b7d3f6", "#e3a008", "#ededef"];

export function confetti(intensity = 1) {
  if (typeof document === "undefined") return;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:100";
  document.body.appendChild(canvas);
  const dpr = window.devicePixelRatio || 1;
  canvas.width = window.innerWidth * dpr;
  canvas.height = window.innerHeight * dpr;
  const g = canvas.getContext("2d")!;
  g.scale(dpr, dpr);
  const W = window.innerWidth;
  const H = window.innerHeight;
  const count = Math.round(160 * intensity);
  const parts = Array.from({ length: count }, (_, i) => {
    const fromLeft = i % 2 === 0;
    const angle = (fromLeft ? -60 : -120) * (Math.PI / 180) + (Math.random() - 0.5) * 0.9;
    const speed = 9 + Math.random() * 9;
    return {
      x: fromLeft ? -10 : W + 10,
      y: H * 0.75,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      w: 6 + Math.random() * 6,
      h: 8 + Math.random() * 10,
      r: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.3,
      color: COLORS[i % COLORS.length],
    };
  });
  const start = performance.now();
  const frame = (now: number) => {
    const t = now - start;
    g.clearRect(0, 0, W, H);
    for (const p of parts) {
      p.vy += 0.32;
      p.vx *= 0.99;
      p.x += p.vx;
      p.y += p.vy;
      p.r += p.vr;
      g.save();
      g.globalAlpha = Math.max(0, 1 - t / 3200);
      g.translate(p.x, p.y);
      g.rotate(p.r);
      g.fillStyle = p.color;
      g.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.r * 2)));
      g.restore();
    }
    if (t < 3300) requestAnimationFrame(frame);
    else canvas.remove();
  };
  requestAnimationFrame(frame);
}
