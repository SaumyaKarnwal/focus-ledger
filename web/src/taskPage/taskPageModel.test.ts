import { describe, expect, test } from "vitest";
import { modeBarPercent } from "./taskPageModel";

describe("modeBarPercent (README Report and task page polish 1)", () => {
  test("modeBarPercent_withAnEstimate_isLoggedAgainstIt", () => {
    expect(modeBarPercent(30, 120, 300)).toBe(25);
    expect(modeBarPercent(200, 120, 300)).toBe(100);
  });

  test("modeBarPercent_withNoEstimate_isTheModesShareOfTheLoggedTime", () => {
    // Execution 44h 08m of 44h 14m fills almost the whole bar.
    expect(modeBarPercent(2648, 0, 2654)).toBeCloseTo(99.77, 1);
  });

  test("modeBarPercent_nothingLogged_isEmpty", () => {
    expect(modeBarPercent(0, 0, 0)).toBe(0);
    expect(modeBarPercent(0, 0, 90)).toBe(0);
  });
});
