import type { BellDeps, NotificationState } from "../bell/bell";
import type { BellSound } from "../settings/localSettings";

/** A bell that records what it plays and shows. */
export function fakeBell(
  permission: NotificationState = "granted",
  afterRequest: NotificationState = "granted",
) {
  const played: [BellSound, number][] = [];
  const notified: [string, string][] = [];
  const requests: NotificationState[] = [];
  let hidden = false;
  let state = permission;
  const deps: BellDeps = {
    play: (sound, volume) => {
      played.push([sound, volume]);
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
    notified,
    requests,
    setHidden: (value: boolean) => {
      hidden = value;
    },
  };
}
