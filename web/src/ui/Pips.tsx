import type { LoggedMode } from "../ledger/rollup";
import { modeKey } from "../modes/modes";

type Props = {
  /** One entry per logged cycle, in order. */
  modes: readonly LoggedMode[];
  estimated: number;
  /** The running cycle, drawn as an open pip after the logged ones. */
  next?: LoggedMode;
};

/** A dot per cycle, in its mode's color, with a divider where the estimate ends. */
export function Pips({ modes, estimated, next }: Props) {
  const withinEstimate = estimated > 0 ? modes.slice(0, estimated) : modes;
  const over = estimated > 0 ? modes.slice(estimated) : [];
  const nextIsOver =
    next !== undefined && estimated > 0 && modes.length >= estimated;
  return (
    <span className="pips" aria-hidden="true">
      {withinEstimate.map((mode, index) => (
        <span key={`in-${index}`} className="pip" data-mode={modeKey(mode)} />
      ))}
      {(over.length > 0 || nextIsOver) && <span className="pip-divider" />}
      {over.map((mode, index) => (
        <span key={`over-${index}`} className="pip" data-mode={modeKey(mode)} />
      ))}
      {next !== undefined && (
        <span className="pip pip-next" data-mode={modeKey(next)} />
      )}
      {over.length > 0 && <span className="pip-over">{over.length} over</span>}
    </span>
  );
}
