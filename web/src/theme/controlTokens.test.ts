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
