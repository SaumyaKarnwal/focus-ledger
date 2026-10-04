/// <reference types="node" />
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

// README "Colors on light screens": the mode marks and the task rings use soft tints.
const theme = readFileSync(`${process.cwd()}/src/theme/default.css`, "utf8");
const tokens = new Map(
  [...theme.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)].map((match) => [
    match[1],
    match[2].trim(),
  ]),
);

function resolve(name: string): string {
  const value = tokens.get(name);
  if (value === undefined) throw new Error(`${name} is not in the theme`);
  const reference = /^var\((--[a-z0-9-]+)\)$/.exec(value);
  return reference ? resolve(reference[1]) : value.toLowerCase();
}

describe("soft tints", () => {
  test.each([
    ["--mode-deep-mark", "#c9a3c4"],
    ["--mode-execution-mark", "#e9afb4"],
    ["--mode-shallow-mark", "#a6cfcb"],
  ])("theme_%s_isTheSoftTint", (token, color) => {
    expect(resolve(token)).toBe(color);
  });

  test("theme_ringSlices_areTheSoftTintsAndAllDiffer", () => {
    const slices = [1, 2, 3, 4, 5, 6].map((slice) =>
      resolve(`--chart-${slice}`),
    );

    expect(slices).toEqual([
      "#c9a3c4",
      "#e9afb4",
      "#a6cfcb",
      "#b3c2dc",
      "#e2cfa9",
      "#c5ddb8",
    ]);
    expect(new Set(slices).size).toBe(6);
  });
});
