import { useEffect, useRef } from "react";
import type { CyclePb } from "../gen/focusledger/v1/model_pb";
import { localTimeString } from "../ledger/period";
import type { LoggedMode } from "../ledger/rollup";
import { modeKey } from "../modes/modes";
import { MODE_NAMES } from "../today/todayModel";
import { PageHeader } from "../ui/PageHeader";
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
  timeZone: string;
  busy: boolean;
  onStop: (totalMinutes: number) => void;
};

/** The countdown of an extension from the bell. It looks like the running screen. */
export function ExtensionScreen({
  cycle,
  extension,
  nodeName,
  path,
  timeZone,
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
  const mode = cycle.mode as LoggedMode;

  return (
    <div className="focus-page">
      <PageHeader />
      <section className="focus-body" aria-labelledby="extension-heading">
        <div className="focus-heading">
          {path.length > 0 && (
            <span className="crumb" aria-label="Breadcrumb">
              {path.join(" / ")}
            </span>
          )}
          <h2 id="extension-heading" className="title title-l">
            {nodeName}
          </h2>
          <span className="mode-chip" data-mode={modeKey(mode)}>
            <span className="mode-bar" aria-hidden="true" />
            {MODE_NAMES[mode]} · keep going
          </span>
        </div>
        <p className="countdown" aria-label="Time left" role="timer">
          {formatCountdown(remaining)}
        </p>
        <div className="progress">
          <progress
            aria-label="Progress"
            value={elapsed}
            max={extension.minutes * MINUTE_MS}
          />
          <div className="progress-figures">
            <span>
              {Math.floor(elapsed / MINUTE_MS)} of {extension.minutes} more min
            </span>
            <span>ends {localTimeString(endsAt, timeZone)}</span>
          </div>
        </div>
        <p className="estimate-line">
          {extension.loggedMinutes} min already logged
        </p>
      </section>
      <div className="focus-actions">
        <button
          type="button"
          className="button"
          disabled={busy}
          onClick={() => onStop(total)}
        >
          Stop and log {total} min
        </button>
      </div>
    </div>
  );
}
