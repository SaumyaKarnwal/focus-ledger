import { useState } from "react";
import { type ByMode, LOGGED_MODES, type LoggedMode } from "../ledger/rollup";
import { modeKey } from "../modes/modes";
import { formatMinutes, MODE_NAMES } from "../today/todayModel";

export type SplitPart = {
  name: string;
  minutes: number;
  byMode: ByMode<number>;
  /** Set when the part is a mode: the slice takes the mode's color. */
  mode?: LoggedMode;
};

const RING_CENTER = 115;
const RING_RADIUS = 80.5;
const RING_GAP_DEGREES = 0.63;
const RING_PULL = 7;

/**
 * A ring with its legend: one slice per part, in the chart colors. Hovering a
 * slice or a legend row pulls the slice out and fades the others.
 */
export function SplitRing({
  parts,
  label,
  caption,
  showModes,
}: {
  parts: readonly SplitPart[];
  label: string;
  caption: string;
  /** Shows a card with the part's split by mode on hover. */
  showModes: boolean;
}) {
  const [active, setActive] = useState<number>();
  const total = parts.reduce((sum, part) => sum + part.minutes, 0);
  // Each part starts where the parts before it end, in degrees from the top.
  const starts = parts.map(
    (_, index) =>
      (parts.slice(0, index).reduce((sum, part) => sum + part.minutes, 0) /
        total) *
      360,
  );
  const colorOf = (part: SplitPart, index: number) =>
    part.mode !== undefined
      ? { "data-mode": modeKey(part.mode) }
      : { "data-chart": String(index + 1) };
  const activePart = active === undefined ? undefined : parts[active];

  return (
    <div className="split-body">
      <svg
        className="split-ring"
        width="230"
        height="230"
        viewBox="0 0 230 230"
        role="img"
        aria-label={label}
      >
        {parts.map((part, index) => {
          const sweep = (part.minutes / total) * 360;
          const middle = starts[index] + sweep / 2;
          const pull = active === index ? RING_PULL : 0;
          return parts.length === 1 ? (
            <circle
              key={part.name}
              className="split-segment"
              cx={RING_CENTER}
              cy={RING_CENTER}
              r={RING_RADIUS}
              {...colorOf(part, index)}
            />
          ) : (
            <path
              key={part.name}
              className="split-segment"
              d={arc(
                starts[index] + RING_GAP_DEGREES,
                starts[index] + sweep - RING_GAP_DEGREES,
              )}
              data-dim={active !== undefined && active !== index}
              transform={`translate(${(pull * Math.sin(radians(middle))).toFixed(2)} ${(-pull * Math.cos(radians(middle))).toFixed(2)})`}
              onMouseEnter={() => setActive(index)}
              onMouseLeave={() => setActive(undefined)}
              {...colorOf(part, index)}
            />
          );
        })}
        <text
          className="split-total"
          x={RING_CENTER}
          y="113"
          textAnchor="middle"
        >
          {formatMinutes(total)}
        </text>
        <text
          className="split-caption"
          x={RING_CENTER}
          y="135"
          textAnchor="middle"
        >
          {caption}
        </text>
      </svg>
      <ul className="split-legend">
        {parts.map((part, index) => (
          <li
            key={part.name}
            data-dim={active !== undefined && active !== index}
            onMouseEnter={() => setActive(index)}
            onMouseLeave={() => setActive(undefined)}
          >
            <span
              className="split-swatch"
              aria-hidden="true"
              {...colorOf(part, index)}
            />
            <span className="split-name">{part.name}</span>
            <span className="split-minutes">{formatMinutes(part.minutes)}</span>
            <span className="split-percent">
              {Math.round((part.minutes / total) * 100)}%
            </span>
          </li>
        ))}
      </ul>
      {activePart && showModes && (
        <div className="split-tip" role="tooltip">
          <div className="split-tip-head">
            <span
              className="split-swatch"
              aria-hidden="true"
              {...colorOf(activePart, active as number)}
            />
            <span className="split-tip-name">{activePart.name}</span>
            <span className="split-minutes">
              {formatMinutes(activePart.minutes)}
            </span>
          </div>
          {LOGGED_MODES.map((mode) => (
            <div
              key={mode}
              className="split-tip-mode"
              data-mode={modeKey(mode)}
              data-zero={activePart.byMode[mode] === 0 || undefined}
            >
              <span className="estimate-mode-bar" aria-hidden="true" />
              <span>{MODE_NAMES[mode]}</span>
              <span className="split-tip-minutes">
                {formatMinutes(activePart.byMode[mode])}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function radians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** An arc of the ring, clockwise from the top, in degrees. */
function arc(from: number, to: number): string {
  const point = (degrees: number) =>
    `${(RING_CENTER + RING_RADIUS * Math.sin(radians(degrees))).toFixed(2)} ${(RING_CENTER - RING_RADIUS * Math.cos(radians(degrees))).toFixed(2)}`;
  const large = to - from > 180 ? 1 : 0;
  return `M${point(from)} A${RING_RADIUS} ${RING_RADIUS} 0 ${large} 1 ${point(to)}`;
}
