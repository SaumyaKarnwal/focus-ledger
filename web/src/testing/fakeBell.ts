import type { BellDeps, NotificationState } from "../bell/bell";
import type { BellSound, FocusSound } from "../settings/localSettings";

/** A bell that records what it plays and shows. */
export function fakeBell(
  permission: NotificationState = "granted",
  afterRequest: NotificationState = "granted",
) {
  const played: [BellSound, number, number][] = [];
  /** One entry for each stop of the rings. */
  const ringStops: number[] = [];
  /** Each focus sound with whether it has stopped. */
  const focus: { sound: FocusSound; volume: number; stopped: boolean }[] = [];
  const notified: [string, string][] = [];
  const requests: NotificationState[] = [];
  let hidden = false;
  let state = permission;
  const deps: BellDeps = {
    play: (sound, volume, times) => {
      played.push([sound, volume, times]);
      return { stop: () => ringStops.push(played.length) };
    },
    focus: (sound, volume) => {
      const record = { sound, volume, stopped: false };
      focus.push(record);
      return {
        stop: () => {
          record.stopped = true;
        },
      };
    },
    notify: (title, body) => {
      notified.push([title, body]);
    },
    isHidden: () => hidden,
    permission: () => state,
    requestPermission: () => {
      state = afterRequest;
      requests.push(state);
      return Promise.resolve(state);
    },
  };
  return {
    deps,
    played,
    ringStops,
    focus,
    /** The focus sounds that play now. */
    playingFocus: () => focus.filter((record) => !record.stopped),
    notified,
    requests,
    setHidden: (value: boolean) => {
      hidden = value;
    },
  };
}
