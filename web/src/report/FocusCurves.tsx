import { type ByMode, LOGGED_MODES } from "../ledger/rollup";
import { modeKey } from "../modes/modes";
import { MODE_NAMES } from "../today/todayModel";

const WIDTH = 1200;
const HEIGHT = 190;
const TOP = 12;
const BOTTOM = 26;
const LEFT = 40;
const RIGHT = 12;
const STEPS = [5, 10, 15, 30, 60];

/**
 * When you focus: one soft curve per mode over the hours of the day (board
 * R-Report-Week). The curves pass through each hour's value and never dip
 * below zero.
 */
export function FocusCurves({ hours }: { hours: ByMode<number[]> }) {
  const used = LOGGED_MODES.flatMap((mode) =>
    hours[mode].flatMap((minutes, hour) => (minutes > 0 ? [hour] : [])),
  );
  // The boards show 6:00 to 23:00; an earlier or later cycle widens the axis.
  const first = Math.min(6, ...used);
  const last = Math.max(23, ...used.map((hour) => hour + 1));
  const peak = Math.max(...LOGGED_MODES.flatMap((mode) => hours[mode]));
  const step =
    STEPS.find((candidate) => candidate * 2 >= peak) ??
    60 * Math.ceil(peak / 120);
  const top = step * 2;
  const x = (hour: number) =>
    LEFT + ((hour - first) / (last - first)) * (WIDTH - LEFT - RIGHT);
  const y = (minutes: number) =>
    HEIGHT - BOTTOM - (minutes / top) * (HEIGHT - TOP - BOTTOM);
  const ticks = Array.from(
    { length: Math.floor((last - first) / 3) + 1 },
    (_, index) => first + index * 3,
  ).filter((hour) => hour < last);

  return (
    <svg
      className="report-curves"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      role="img"
      aria-label={`Minutes per hour: ${LOGGED_MODES.map((mode) => MODE_NAMES[mode]).join(", ")}`}
    >
      {[step, top].map((minutes) => (
        <g key={minutes}>
          <line
            className="report-grid"
            x1={LEFT}
            x2={WIDTH - RIGHT}
            y1={y(minutes)}
            y2={y(minutes)}
          />
          <text className="report-axis" x={0} y={y(minutes) + 4}>
            {minutes}m
          </text>
        </g>
      ))}
      <line
        className="report-base"
        x1={LEFT}
        x2={WIDTH - RIGHT}
        y1={y(0)}
        y2={y(0)}
      />
      {ticks.map((hour) => (
        <text
          key={hour}
          className="report-axis"
          x={x(hour)}
          y={HEIGHT - 6}
          textAnchor="middle"
        >
          {hour}:00
        </text>
      ))}
      {LOGGED_MODES.map((mode) => {
        const points = Array.from({ length: last - first + 1 }, (_, index) => {
          const hour = first + index;
          // Each hour's minutes sit in the middle of that hour.
          const minutes = hour < last ? hours[mode][hour % 24] : 0;
          return [x(hour + 0.5), y(minutes)] as const;
        });
        const line = smoothPath([
          [x(first), y(0)],
          ...points.slice(0, -1),
          [x(last), y(0)],
        ]);
        return (
          <g key={mode} className="report-curve" data-mode={modeKey(mode)}>
            <path
              className="report-curve-area"
              d={`${line} L${x(last)} ${y(0)} L${x(first)} ${y(0)} Z`}
            />
            <path className="report-curve-line" d={line} />
          </g>
        );
      })}
    </svg>
  );
}

/**
 * A monotone cubic curve through the points (Fritsch-Carlson), so the curve
 * never overshoots a point: no bump above a peak and no dip below zero.
 */
function smoothPath(points: readonly (readonly [number, number])[]): string {
  const count = points.length;
  if (count < 2) return "";
  const slopes = points.slice(1).map(([x1, y1], index) => {
    const [x0, y0] = points[index];
    return (y1 - y0) / (x1 - x0);
  });
  const tangents = points.map((_, index) => {
    if (index === 0) return slopes[0];
    if (index === count - 1) return slopes[count - 2];
    const before = slopes[index - 1];
    const after = slopes[index];
    if (before * after <= 0) return 0;
    return (2 * before * after) / (before + after);
  });
  const [startX, startY] = points[0];
  return points.slice(1).reduce(
    (path, [x1, y1], index) => {
      const [x0, y0] = points[index];
      const third = (x1 - x0) / 3;
      const c1 = `${(x0 + third).toFixed(1)} ${(y0 + tangents[index] * third).toFixed(1)}`;
      const c2 = `${(x1 - third).toFixed(1)} ${(y1 - tangents[index + 1] * third).toFixed(1)}`;
      return `${path} C${c1} ${c2} ${x1.toFixed(1)} ${y1.toFixed(1)}`;
    },
    `M${startX.toFixed(1)} ${startY.toFixed(1)}`,
  );
}
