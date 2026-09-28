import { useEffect, useRef } from "react";
import type { CyclePb } from "../gen/focusledger/v1/model_pb";
import type { LoggedMode } from "../ledger/rollup";
import { MODE_NAMES } from "../today/todayModel";
import { useNow } from "../useNow";
import {
  type Extension,
  extensionElapsedMs,
  extensionRemainingMs,
  extensionTotalMinutes,
  formatClockTime,
  formatCountdown,
} from "./timer";

const MINUTE_MS = 60_000;

type Props = {
  cycle: CyclePb;
  extension: Extension;
  nodeName: string;
  busy: boolean;
  onStop: (totalMinutes: number) => void;
};

export function ExtensionScreen({
  cycle,
  extension,
  nodeName,
  busy,
  onStop,
}: Props) {
  const now = useNow();
  const remaining = extensionRemainingMs(extension, now);
  const total = extensionTotalMinutes(extension, now);
  const endHandled = useRef(false);

  useEffect(() => {
    if (remaining === 0 && !endHandled.current) {
      endHandled.current = true;
      onStop(extension.loggedMinutes + extension.minutes);
    }
  }, [remaining, extension, onStop]);

  const elapsed = extensionElapsedMs(extension, now);
  const endsAt = new Date(
    extension.startedAtMs + extension.minutes * MINUTE_MS,
  );

  return (
    <section aria-labelledby="extension-heading">
      <h2 id="extension-heading">{nodeName}</h2>
      <p>{MODE_NAMES[cycle.mode as LoggedMode]} · keep going</p>
      <p aria-label="Time left" role="timer">
        {formatCountdown(remaining)}
      </p>
      <progress
        aria-label="Progress"
        value={elapsed}
        max={extension.minutes * MINUTE_MS}
      />
      <p>
        {Math.floor(elapsed / MINUTE_MS)} of {extension.minutes} more min · ends
        at {formatClockTime(endsAt)}
      </p>
      <button type="button" disabled={busy} onClick={() => onStop(total)}>
        Stop and log {total} min
      </button>
    </section>
  );
}
