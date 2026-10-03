import { useEffect, useRef } from "react";
import type { CyclePb } from "../gen/focusledger/v1/model_pb";
import { localTimeString } from "../ledger/period";
import type { LoggedMode } from "../ledger/rollup";
import { modeKey } from "../modes/modes";
import { MODE_NAMES } from "../today/todayModel";
import {
  BoundTask,
  ModePlate,
  ModeScreenFrame,
  ScreenClock,
} from "../start/ModeScreenFrame";
import { useNow } from "../useNow";
import {
  type Extension,
  extensionElapsedMs,
  extensionRemainingMs,
  extensionTotalMinutes,
  formatCountdown,
} from "./timer";

const MINUTE_MS = 60_000;

type Props = {
  cycle: CyclePb;
  extension: Extension;
  nodeName: string;
  path: string[];
  email: string;
  timeZone: string;
  busy: boolean;
  onStop: (totalMinutes: number) => void;
  onSignOut: () => void;
};

/** The countdown of an extension from the bell. It has the layout of the running screen. */
export function ExtensionScreen({
  cycle,
  extension,
  nodeName,
  path,
  email,
  timeZone,
  busy,
  onStop,
  onSignOut,
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
  const mode = cycle.mode as LoggedMode;

  return (
    <ModeScreenFrame
      modeKey={modeKey(mode)}
      timeZone={timeZone}
      email={email}
      onSignOut={onSignOut}
      strip={
        <BoundTask
          name={nodeName === "Inbox" ? "Not sure yet" : nodeName}
          detail={path.join(" / ")}
        />
      }
    >
      <ModePlate label="Keep going" name={MODE_NAMES[mode]} />
      <section className="start-clock" aria-label="Extension">
        <ScreenClock
          label="Time left"
          text={formatCountdown(remaining)}
          progress={elapsed / (extension.minutes * MINUTE_MS)}
          note={
            <p className="screen-note">
              {extension.loggedMinutes} min already logged · ends{" "}
              {localTimeString(endsAt, timeZone)}
            </p>
          }
        />
        <div className="start-actions">
          <button
            type="button"
            className="screen-outline"
            aria-label={`Stop and log ${total} min`}
            disabled={busy}
            onClick={() => onStop(total)}
          >
            Stop and log
          </button>
        </div>
      </section>
    </ModeScreenFrame>
  );
}
