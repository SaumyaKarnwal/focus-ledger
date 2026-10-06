import type { LoggedMode } from "../ledger/rollup";
import { modeKey } from "../modes/modes";
import {
  ESTIMATE_COUNT,
  ESTIMATE_LENGTH,
  type EstimateRow,
  stepWithin,
} from "../tree/estimateModel";
import { MODE_NAMES } from "../today/todayModel";

/** One mode's length × cycles row, in the New task and Log time dialogs. */
export function EstimateLine({
  mode,
  row,
  lit = false,
  onChange,
}: {
  mode: LoggedMode;
  row: EstimateRow;
  /** Log time: a row with cycles takes its mode's tint. */
  lit?: boolean;
  onChange: (row: EstimateRow) => void;
}) {
  const name = MODE_NAMES[mode];
  return (
    <div
      className="task-estimate"
      data-mode={modeKey(mode)}
      data-lit={(lit && row.cycleCount > 0) || undefined}
    >
      <span className="task-estimate-bar" aria-hidden="true" />
      <span className="task-estimate-name">{name}</span>
      <Stepper
        label={`${name} minutes per cycle`}
        value={row.cycleMinutes}
        less="5 minutes less"
        more="5 minutes more"
        onStep={(sign) =>
          onChange({
            ...row,
            cycleMinutes: stepWithin(
              row.cycleMinutes,
              sign * ESTIMATE_LENGTH.step,
              ESTIMATE_LENGTH,
            ),
          })
        }
      />
      <span className="task-estimate-unit">min</span>
      <span className="task-estimate-unit" aria-hidden="true">
        ×
      </span>
      <Stepper
        label={`${name} cycles`}
        value={row.cycleCount}
        less="One cycle less"
        more="One cycle more"
        narrow
        onStep={(sign) =>
          onChange({
            ...row,
            cycleCount: stepWithin(
              row.cycleCount,
              sign * ESTIMATE_COUNT.step,
              ESTIMATE_COUNT,
            ),
          })
        }
      />
    </div>
  );
}

function Stepper({
  label,
  value,
  less,
  more,
  narrow = false,
  onStep,
}: {
  label: string;
  value: number;
  less: string;
  more: string;
  narrow?: boolean;
  onStep: (sign: 1 | -1) => void;
}) {
  return (
    <span className="estimate-stepper" role="group" aria-label={label}>
      <button
        type="button"
        className="estimate-step"
        aria-label={`${label}: ${less}`}
        onClick={() => onStep(-1)}
      >
        −
      </button>
      <output
        className="estimate-value"
        data-narrow={narrow || undefined}
        aria-label={label}
      >
        {value}
      </output>
      <button
        type="button"
        className="estimate-step"
        aria-label={`${label}: ${more}`}
        onClick={() => onStep(1)}
      >
        +
      </button>
    </span>
  );
}
