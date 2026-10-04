import type { FocusSound } from "../settings/localSettings";
import type { Playing } from "./sounds";

/** The part of an AudioContext that the focus sound uses. */
export type FocusContext = Pick<
  BaseAudioContext,
  | "sampleRate"
  | "destination"
  | "createBuffer"
  | "createBufferSource"
  | "createGain"
>;

type Loop = { seconds: number; level: number };

// One loop of each sound. A tick loop holds one tick; a noise loop is long
// enough that the repeat is not heard. The levels even out the loudness.
const LOOPS: Record<Exclude<FocusSound, "none">, Loop> = {
  "tick-fast": { seconds: 0.5, level: 0.6 },
  "tick-slow": { seconds: 1, level: 0.6 },
  "white-noise": { seconds: 3, level: 0.18 },
  "brown-noise": { seconds: 4, level: 0.5 },
};

const TICK_HZ = 2600;
const TICK_DECAY_SECONDS = 0.0016;
const TICK_SECONDS = 0.012;

/** One loop of samples, from -1 to 1. "none" has none. */
export function focusSamples(
  sound: FocusSound,
  sampleRate: number,
  random: () => number = Math.random,
): Float32Array<ArrayBuffer> {
  if (sound === "none") return new Float32Array(0);
  const { seconds, level } = LOOPS[sound];
  const length = Math.round(seconds * sampleRate);
  if (sound === "tick-fast" || sound === "tick-slow") {
    return Float32Array.from({ length }, (_, index) => {
      const time = index / sampleRate;
      return time < TICK_SECONDS
        ? level *
            Math.sin(2 * Math.PI * TICK_HZ * time) *
            Math.exp(-time / TICK_DECAY_SECONDS)
        : 0;
    });
  }
  const white = Float32Array.from({ length }, () => random() * 2 - 1);
  if (sound === "white-noise") return white.map((value) => value * level);
  // Brown noise: each sample leans on the one before, so the low end is strong.
  let previous = 0;
  const brown = white.map((value) => {
    previous = (previous + 0.02 * value) / 1.02;
    return previous;
  });
  const peak = brown.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
  return brown.map((value) => (value / Math.max(peak, 0.0001)) * level);
}

/** Loops the sound at `volume` (0 to 1) until `stop`. */
export function startFocusSound(
  context: FocusContext,
  sound: FocusSound,
  volume: number,
): Playing {
  const samples = focusSamples(sound, context.sampleRate);
  if (samples.length === 0 || volume <= 0) return { stop: () => undefined };
  const buffer = context.createBuffer(1, samples.length, context.sampleRate);
  buffer.copyToChannel(samples, 0);
  const source = context.createBufferSource();
  const gain = context.createGain();
  source.buffer = buffer;
  source.loop = true;
  gain.gain.value = Math.min(1, volume);
  source.connect(gain);
  gain.connect(context.destination);
  source.start();
  return {
    stop: () => {
      source.stop();
      gain.disconnect();
    },
  };
}
