export type SoundName =
  | "click"
  | "toggle"
  | "send"
  | "select"
  | "pop"
  | "success"
  | "wait"
  | "stop"
  | "error"
  | "add";

const STORAGE_KEY = "hive-sound-muted";

let ctx: AudioContext | null = null;
let muted =
  typeof localStorage !== "undefined" &&
  localStorage.getItem(STORAGE_KEY) === "1";

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AC =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!AC) return null;
  if (!ctx) ctx = new AC();
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

function tone(
  frequency: number,
  duration: number,
  opts: {
    type?: OscillatorType;
    gain?: number;
    attack?: number;
    decay?: number;
    slideTo?: number;
  } = {}
) {
  const audio = getCtx();
  if (!audio || muted) return;

  const now = audio.currentTime;
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  const filter = audio.createBiquadFilter();

  osc.type = opts.type ?? "sine";
  osc.frequency.setValueAtTime(frequency, now);
  if (opts.slideTo != null) {
    osc.frequency.exponentialRampToValueAtTime(
      Math.max(40, opts.slideTo),
      now + duration
    );
  }

  filter.type = "lowpass";
  filter.frequency.value = 2400;

  const peak = opts.gain ?? 0.045;
  const attack = opts.attack ?? 0.008;
  const decay = opts.decay ?? duration;

  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(peak, now + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + decay);

  osc.connect(filter);
  filter.connect(gain);
  gain.connect(audio.destination);

  osc.start(now);
  osc.stop(now + duration + 0.02);
}

function chord(freqs: number[], duration: number, gain = 0.03) {
  freqs.forEach((f, i) => {
    setTimeout(() => {
      tone(f, duration, { gain: gain * (1 - i * 0.12), type: "triangle" });
    }, i * 28);
  });
}

export function isSoundMuted() {
  return muted;
}

export function setSoundMuted(next: boolean) {
  muted = next;
  try {
    localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
  } catch {
    /* ignore */
  }
  if (!next) play("toggle");
}

export function toggleSoundMuted() {
  setSoundMuted(!muted);
  return muted;
}

export function play(name: SoundName) {
  if (muted) return;
  switch (name) {
    case "click":
      tone(520, 0.05, { type: "triangle", gain: 0.03, decay: 0.06 });
      tone(780, 0.04, { type: "sine", gain: 0.018, decay: 0.05 });
      break;
    case "toggle":
      tone(420, 0.07, { type: "sine", gain: 0.035, slideTo: 640 });
      break;
    case "send":
      tone(480, 0.08, { type: "triangle", gain: 0.04, slideTo: 720 });
      setTimeout(
        () => tone(880, 0.1, { type: "sine", gain: 0.028, decay: 0.12 }),
        40
      );
      break;
    case "select":
      tone(360, 0.09, { type: "sine", gain: 0.035, slideTo: 540 });
      setTimeout(
        () => tone(720, 0.08, { type: "triangle", gain: 0.022 }),
        35
      );
      break;
    case "pop":
      tone(220, 0.1, {
        type: "sine",
        gain: 0.05,
        slideTo: 480,
        attack: 0.004,
        decay: 0.12,
      });
      break;
    case "success":
      chord([523.25, 659.25, 783.99], 0.14, 0.032);
      break;
    case "wait":
      tone(340, 0.12, { type: "sine", gain: 0.03, slideTo: 300 });
      break;
    case "stop":
      tone(300, 0.1, { type: "sawtooth", gain: 0.02, slideTo: 140 });
      break;
    case "error":
      tone(180, 0.14, { type: "square", gain: 0.018, slideTo: 120 });
      break;
    case "add":
      tone(500, 0.07, { type: "triangle", gain: 0.03, slideTo: 700 });
      setTimeout(
        () => tone(900, 0.09, { type: "sine", gain: 0.025 }),
        50
      );
      break;
    default:
      break;
  }
}

/** Soft UI clicks for buttons / cards / bubbles */
export function bindClickSounds(root: ParentNode = document) {
  const handler = (e: Event) => {
    const t = e.target;
    if (!(t instanceof Element)) return;
    const hit = t.closest(
      "button, .card, .agent-bubble, .view-toggle button, a[href]"
    );
    if (!hit) return;
    if (hit instanceof HTMLButtonElement && hit.disabled) return;
    // Specific buttons play richer sounds elsewhere; keep a light click
    if (hit.classList.contains("btn-primary")) {
      // form submit handler plays send — avoid double-fire on click
      play("click");
      return;
    }
    if (hit.classList.contains("btn-danger")) {
      play("stop");
      return;
    }
    if (hit.classList.contains("agent-bubble")) {
      play("select");
      return;
    }
    if (hit.classList.contains("card")) {
      play("pop");
      return;
    }
    play("click");
  };
  const onSubmit = () => play("send");

  root.addEventListener("pointerdown", handler, true);
  root.addEventListener("submit", onSubmit, true);
  return () => {
    root.removeEventListener("pointerdown", handler, true);
    root.removeEventListener("submit", onSubmit, true);
  };
}
