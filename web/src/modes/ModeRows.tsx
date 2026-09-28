import type { ReactNode } from "react";
import {
  type ByMode,
  type CycleCounts,
  LOGGED_MODES,
  type LoggedMode,
} from "../ledger/rollup";
import {
  ESTIMATE_COUNT,
  ESTIMATE_LENGTH,
  type EstimateRow,
  stepWithin,
} from "../tree/estimateModel";
import { formatMinutes, MODE_NAMES } from "../today/todayModel";
import { Pips } from "../ui/Pips";
import { MODE_DESCRIPTIONS, MODE_KEYS, MODE_SHORT_DESCRIPTIONS } from "./modes";

export type ModeProgress = ByMode<CycleCounts & { cycleMinutes?: number }>;

type Props = {
  /** With `onSelect`, each row is a radio button of the group `groupName`. */
  selected?: LoggedMode;
  onSelect?: (mode: LoggedMode) => void;
  groupName?: string;
  descriptions?: "long" | "short";
  /** At rest: the done and estimated cycles per mode. */
  progress?: ModeProgress;
  /** While editing: length × count steppers per mode. */
  estimate?: {
    rows: ByMode<EstimateRow>;
    onChange: (rows: ByMode<EstimateRow>) => void;
  };
};

/** The three mode rows. One component for choosing a mode and for estimates (FR-6). */
export function ModeRows({
  selected,
  onSelect,
  groupName,
  descriptions,
  progress,
  estimate,
}: Props) {
  return (
    <div className="mode-rows">
      {LOGGED_MODES.map((mode) => {
        const name = MODE_NAMES[mode];
        const description =
          descriptions === "long"
            ? MODE_DESCRIPTIONS[mode]
            : descriptions === "short"
              ? MODE_SHORT_DESCRIPTIONS[mode]
              : undefined;
        const content = (
          <>
            {onSelect && (
              <input
                type="radio"
                className="visually-hidden"
                name={groupName}
                aria-label={name}
                checked={selected === mode}
                onChange={() => onSelect(mode)}
              />
            )}
            <span className="mode-bar" aria-hidden="true" />
            {description && descriptions === "long" ? (
              <span className="mode-row-text">
                <span className="mode-row-name">{name}</span>
                <span className="mode-row-description">{description}</span>
              </span>
            ) : (
              <span className="mode-row-name">{name}</span>
            )}
            {description && descriptions === "short" && (
              <span className="mode-row-middle mode-row-description">
                {description}
              </span>
            )}
            {estimate && (
              <EstimateSteppers
                name={name}
                row={estimate.rows[mode]}
                onChange={(row) =>
                  estimate.onChange({ ...estimate.rows, [mode]: row })
                }
              />
            )}
            {progress && !estimate && (
              <ProgressFigures counts={progress[mode]} mode={mode} />
            )}
          </>
        );
        const rowProps = {
          className: "mode-row",
          "data-mode": MODE_KEYS[mode],
          "data-selected": selected === mode,
          "data-selectable": onSelect !== undefined,
        };
        return onSelect ? (
          <label key={mode} {...rowProps}>
            {content}
          </label>
        ) : (
          <div key={mode} {...rowProps}>
            {content}
          </div>
        );
      })}
    </div>
  );
}

function ProgressFigures({
  counts,
  mode,
}: {
  counts: CycleCounts & { cycleMinutes?: number };
  mode: LoggedMode;
}) {
  const { doneCycles, estimatedCycles, cycleMinutes } = counts;
  const figure: ReactNode =
    estimatedCycles > 0
      ? `${doneCycles} of ${estimatedCycles} · ${cycleMinutes} min`
      : doneCycles > 0
        ? `${doneCycles} · no est.`
        : "—";
  return (
    <>
      <span className="mode-row-middle">
        {doneCycles > 0 || estimatedCycles > 0 ? (
          <Pips
            modes={Array.from({ length: doneCycles }, () => mode)}
            estimated={estimatedCycles}
          />
        ) : (
          "not estimated, none logged"
        )}
      </span>
      <span
        className="mode-row-figure"
        data-empty={estimatedCycles === 0 && doneCycles === 0}
      >
        {figure}
      </span>
    </>
  );
}

function EstimateSteppers({
  name,
  row,
  onChange,
}: {
  name: string;
  row: EstimateRow;
  onChange: (row: EstimateRow) => void;
}) {
  const step = (field: keyof EstimateRow, by: number) =>
    onChange({
      ...row,
      [field]: stepWithin(
        row[field],
        by,
        field === "cycleMinutes" ? ESTIMATE_LENGTH : ESTIMATE_COUNT,
      ),
    });
  return (
    <>
      <span className="stepper">
        <button
          type="button"
          className="icon-button"
          aria-label={`Fewer ${name} minutes`}
          onClick={() => step("cycleMinutes", -ESTIMATE_LENGTH.step)}
        >
          −
        </button>
        <output aria-label={`${name} length`}>{row.cycleMinutes}</output>
        <button
          type="button"
          className="icon-button"
          aria-label={`More ${name} minutes`}
          onClick={() => step("cycleMinutes", ESTIMATE_LENGTH.step)}
        >
          +
        </button>
        <span className="stepper-unit">min</span>
      </span>
      <span className="stepper-unit" aria-hidden="true">
        ×
      </span>
      <span className="stepper">
        <button
          type="button"
          className="icon-button"
          aria-label={`Fewer ${name} cycles`}
          onClick={() => step("cycleCount", -ESTIMATE_COUNT.step)}
        >
          −
        </button>
        <output aria-label={`${name} count`}>{row.cycleCount}</output>
        <button
          type="button"
          className="icon-button"
          aria-label={`More ${name} cycles`}
          onClick={() => step("cycleCount", ESTIMATE_COUNT.step)}
        >
          +
        </button>
      </span>
      <span
        className="mode-row-figure mode-row-subtotal"
        data-empty={row.cycleCount === 0}
      >
        {row.cycleCount > 0
          ? formatMinutes(row.cycleCount * row.cycleMinutes)
          : "—"}
      </span>
    </>
  );
}
