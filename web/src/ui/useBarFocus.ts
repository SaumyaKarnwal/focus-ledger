import { useState } from "react";

/**
 * The shared behavior of a bar chart (README "Report and task page polish" 5):
 * at rest no figure shows; hover, keyboard focus, or a tap makes one bar the
 * active one, the others fade, and the chart shows that bar's card. A second
 * tap on the same bar clears it.
 */
export function useBarFocus() {
  const [active, setActive] = useState<number>();
  const barProps = (index: number) => ({
    tabIndex: 0,
    "data-dim": active !== undefined && active !== index,
    onMouseEnter: () => setActive(index),
    onMouseLeave: () => setActive(undefined),
    onFocus: () => setActive(index),
    onBlur: () => setActive(undefined),
    onClick: () =>
      setActive((current) => (current === index ? undefined : index)),
  });
  return { active, barProps };
}
