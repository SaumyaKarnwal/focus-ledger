import { type FormEvent, useState } from "react";
import type { CyclePb } from "../gen/focusledger/v1/model_pb";
import type { LoggedMode } from "../ledger/rollup";
import { MODE_NAMES } from "../today/todayModel";

const MAX_CYCLE_MINUTES = 1440;

type Props = {
  cycle: CyclePb;
  nodeName: string;
  busy: boolean;
  onExtend: (moreMinutes: number) => void;
  onBreak: () => void;
  onNewCycle: () => void;
};

export function BellScreen({
  cycle,
  nodeName,
  busy,
  onExtend,
  onBreak,
  onNewCycle,
}: Props) {
  const [moreMinutes, setMoreMinutes] = useState("");
  const logged = cycle.minutes ?? 0;
  const extension = Number(moreMinutes);
  const validExtension =
    Number.isInteger(extension) &&
    extension >= 1 &&
    logged + extension <= MAX_CYCLE_MINUTES;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!validExtension) return;
    onExtend(extension);
    setMoreMinutes("");
  };

  return (
    <section aria-labelledby="bell-heading">
      <p>{MODE_NAMES[cycle.mode as LoggedMode]} · logged</p>
      <h2 id="bell-heading">{nodeName}</h2>
      <p>{logged} min logged</p>
      <form onSubmit={submit}>
        <label>
          Keep going for{" "}
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={MAX_CYCLE_MINUTES - logged}
            aria-label="Keep going for more minutes"
            value={moreMinutes}
            onChange={(event) => setMoreMinutes(event.target.value)}
          />{" "}
          more minutes
        </label>{" "}
        <button type="submit" disabled={busy || !validExtension}>
          Keep going
        </button>
      </form>
      <button type="button" disabled={busy} onClick={onBreak}>
        Take a break
      </button>{" "}
      <button type="button" disabled={busy} onClick={onNewCycle}>
        Start a new cycle
      </button>
    </section>
  );
}
