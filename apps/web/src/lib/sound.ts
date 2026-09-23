import type { FillKind } from "./fills";

const MUTE_KEY = "alpha:sound-muted";

export function isMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

export function setMuted(muted: boolean): void {
  try {
    localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
  } catch {
    // Storage blocked: the choice just lasts until the page closes.
  }
}

let context: AudioContext | undefined;

/// [frequency Hz, start s, length s, waveform]
type Note = [number, number, number, OscillatorType];

// Synthesized, so there are no audio files to ship. A win climbs; a stop-loss is one low, soft note;
// a liquidation falls.
const tunes: Record<FillKind, Note[]> = {
  TAKE_PROFIT: [
    [523.25, 0, 0.14, "triangle"],
    [659.25, 0.1, 0.14, "triangle"],
    [783.99, 0.2, 0.14, "triangle"],
    [1046.5, 0.3, 0.42, "triangle"],
  ],
  STOP_LOSS: [[329.63, 0, 0.35, "sine"]],
  LIQUIDATION: [
    [293.66, 0, 0.18, "sine"],
    [220, 0.16, 0.4, "sine"],
  ],
  TRIGGER: [[523.25, 0, 0.3, "sine"]],
};

/// Plays the tune for `kind` unless the user muted sound. Does nothing, quietly, where the browser has no
/// audio or has not yet allowed it (it allows it after the first click or key press on the page).
export function playFillSound(kind: FillKind): void {
  if (isMuted()) return;
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    context ??= new Ctor();
    const audio = context;
    if (audio.state === "suspended") void audio.resume();
    const now = audio.currentTime;
    for (const [frequency, start, length, type] of tunes[kind]) {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = type;
      osc.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, now + start);
      gain.gain.exponentialRampToValueAtTime(0.12, now + start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + start + length);
      osc.connect(gain).connect(audio.destination);
      osc.start(now + start);
      osc.stop(now + start + length + 0.05);
    }
  } catch {
    // No sound is better than a broken alert.
  }
}
