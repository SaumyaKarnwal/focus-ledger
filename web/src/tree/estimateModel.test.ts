import { create } from "@bufbuild/protobuf";
import { describe, expect, test } from "vitest";
import {
  FocusMode,
  NodePbSchema,
  SettingsPbSchema,
} from "../gen/focusledger/v1/model_pb";
import {
  estimateRows,
  estimateSummary,
  stepWithin,
  toEstimates,
} from "./estimateModel";

const settings = create(SettingsPbSchema, {
  deepFocusMinutes: 90,
  executionMinutes: 50,
  shallowMinutes: 25,
});

describe("estimateModel", () => {
  test("estimateRows_oneSavedMode_fillsTheOthersFromSettings", () => {
    const node = create(NodePbSchema, {
      estimates: [
        { mode: FocusMode.EXECUTION, cycleMinutes: 45, cycleCount: 6 },
      ],
    });

    expect(estimateRows(node, settings)).toEqual({
      [FocusMode.DEEP_FOCUS]: { cycleMinutes: 90, cycleCount: 0 },
      [FocusMode.EXECUTION]: { cycleMinutes: 45, cycleCount: 6 },
      [FocusMode.SHALLOW]: { cycleMinutes: 25, cycleCount: 0 },
    });
  });

  test("estimateRows_clearedModeRow_keepsItsLengthAtCountZero", () => {
    const node = create(NodePbSchema, {
      estimates: [
        { mode: FocusMode.EXECUTION, cycleMinutes: 45, cycleCount: 0 },
      ],
    });

    expect(estimateRows(node, settings)[FocusMode.EXECUTION]).toEqual({
      cycleMinutes: 45,
      cycleCount: 0,
    });
    expect(estimateSummary(estimateRows(node, settings))).toEqual({
      cycles: 0,
      minutes: 0,
    });
  });

  test("toEstimates_rows_givesOneEstimatePerMode", () => {
    const rows = estimateRows(create(NodePbSchema), settings);

    expect(toEstimates(rows).map((estimate) => estimate.mode)).toEqual([
      FocusMode.DEEP_FOCUS,
      FocusMode.EXECUTION,
      FocusMode.SHALLOW,
    ]);
  });

  test("estimateSummary_twoModes_addsCyclesAndMinutes", () => {
    const rows = {
      [FocusMode.DEEP_FOCUS]: { cycleMinutes: 90, cycleCount: 2 },
      [FocusMode.EXECUTION]: { cycleMinutes: 50, cycleCount: 6 },
      [FocusMode.SHALLOW]: { cycleMinutes: 25, cycleCount: 0 },
    };

    expect(estimateSummary(rows)).toEqual({ cycles: 8, minutes: 480 });
  });

  test("stepWithin_pastTheLimits_staysInRange", () => {
    expect(stepWithin(0, -1, { min: 0, max: 99 })).toBe(0);
    expect(stepWithin(480, 5, { min: 5, max: 480 })).toBe(480);
  });
});
