/// <reference types="node" />
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

// Vitest runs from web/.
const SRC = `${process.cwd()}/src/`;
const theme = readFileSync(`${SRC}theme/default.css`, "utf8");
const styles = readdirSync(`${SRC}styles`).filter((file) =>
  file.endsWith(".css"),
);

describe("the Settings control tokens (issue 230)", () => {
  test.each([
    ["--control-bg", "#fbf2f4"],
    ["--control-edge", "#ebc4c9"],
    ["--control-hover", "#f6e3e6"],
  ])("theme_%s_isTheSoftPink", (token, color) => {
    expect(theme).toContain(`${token}: ${color};`);
  });

  test("controlTokens_onlySettingsUsesThem", () => {
    const users = styles.filter((file) =>
      /var\(--control-/.test(readFileSync(`${SRC}styles/${file}`, "utf8")),
    );

    expect(users).toEqual(["settingsPage.css"]);
  });
});

function hexOf(token: string): string {
  const match = new RegExp(`${token}: (#[0-9a-f]{6});`).exec(theme);
  if (!match) throw new Error(`${token} has no hex value`);
  return match[1];
}

function luminance(hex: string): number {
  const [red, green, blue] = [1, 3, 5].map((start) => {
    const channel = parseInt(hex.slice(start, start + 2), 16) / 255;
    return channel <= 0.03928
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrast(first: string, second: string): number {
  const [light, dark] = [luminance(first), luminance(second)].sort(
    (a, b) => b - a,
  );
  return (light + 0.05) / (dark + 0.05);
}

describe("the switch off state (issue 236)", () => {
  test.each(["--paper-100", "--paper-50", "--white"])(
    "switchEdge_against%s_isAtLeast3To1",
    (background) => {
      expect(
        contrast(hexOf("--control-edge-strong"), hexOf(background)),
      ).toBeGreaterThanOrEqual(3);
    },
  );
});
