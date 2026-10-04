import type { ReactNode } from "react";

/**
 * The small card of the active bar, beside it, so the bar stays in view. It
 * opens to the left for the bars in the right half of the chart. `axis` is the
 * width before the first bar, such as the hour labels.
 */
export function BarTip({
  index,
  count,
  axis = "0px",
  className,
  children,
}: {
  index: number;
  count: number;
  axis?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={`split-tip bar-tip ${className ?? ""}`}
      role="tooltip"
      data-edge={index >= count / 2 ? "end" : undefined}
      style={{
        left: `calc(${axis} + (100% - ${axis}) * ${(index + 0.5) / count})`,
      }}
    >
      {children}
    </div>
  );
}
