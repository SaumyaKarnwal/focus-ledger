import type { BellSound } from "../settings/localSettings";

/** The part of an AudioContext that the sounds use. An OfflineAudioContext also fits. */
export type SoundContext = Pick<
  BaseAudioContext,
  "currentTime" | "destination" | "createOscillator" | "createGain"
>;

type Partial = { ratio: number; level: number; decaySeconds: number };

type Voice = {
  baseHz: number;
  wave: OscillatorType;
  attackSeconds: number;
  partials: readonly Partial[];
};

// Struck sounds as a few partials, each with its own decay. The ratios of the
// bowl are inharmonic, as on a real singing bowl.
const VOICES: Record<BellSound, Voice> = {
  bowl: {
    baseHz: 220,
    wave: "sine",
    attackSeconds: 0.02,
    partials: [
      { ratio: 1, level: 1, decaySeconds: 4.5 },
      { ratio: 2.76, level: 0.5, decaySeconds: 3 },
      { ratio: 5.4, level: 0.25, decaySeconds: 2 },
      { ratio: 8.93, level: 0.12, decaySeconds: 1.2 },
    ],
  },
  wood: {
    baseHz: 760,
    wave: "triangle",
    attackSeconds: 0.002,
    partials: [
      { ratio: 1, level: 1, decaySeconds: 0.12 },
      { ratio: 2.3, level: 0.4, decaySeconds: 0.07 },
      { ratio: 4.1, level: 0.2, decaySeconds: 0.04 },
    ],
  },
  chime: {
    baseHz: 880,
    wave: "sine",
    attackSeconds: 0.005,
    partials: [
      { ratio: 1, level: 1, decaySeconds: 2.2 },
      { ratio: 2, level: 0.45, decaySeconds: 1.6 },
      { ratio: 3, level: 0.25, decaySeconds: 1.1 },
      { ratio: 4.2, level: 0.15, decaySeconds: 0.8 },
    ],
  },
};

/** The loudest the sum of the partials gets, so that full volume does not clip. */
const HEADROOM = 0.5;
const SILENCE = 0.0001;

/** Plays the sound once at `volume` (0 to 1). Returns its length in seconds. */
export function playSound(
  context: SoundContext,
  sound: BellSound,
  volume: number,
  at = context.currentTime,
): number {
  const voice = VOICES[sound];
  if (volume <= 0) return 0;
  const total = voice.partials.reduce((sum, partial) => sum + partial.level, 0);
  const scale = (Math.min(1, volume) * HEADROOM) / total;
  return Math.max(
    ...voice.partials.map((partial) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const peakAt = at + voice.attackSeconds;
      const endAt = peakAt + partial.decaySeconds;
      oscillator.type = voice.wave;
      oscillator.frequency.setValueAtTime(voice.baseHz * partial.ratio, at);
      gain.gain.setValueAtTime(SILENCE, at);
      gain.gain.linearRampToValueAtTime(partial.level * scale, peakAt);
      gain.gain.exponentialRampToValueAtTime(SILENCE, endAt);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(at);
      oscillator.stop(endAt + 0.05);
      return endAt - at;
    }),
  );
}
