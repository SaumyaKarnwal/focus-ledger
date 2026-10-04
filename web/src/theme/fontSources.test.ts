/// <reference types="node" />
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

// Every font comes from the bundle: a Google Fonts request sends the user's
// address to Google (#199).
const WEB = `${process.cwd()}/`;
const files = [
  "index.html",
  ...readdirSync(`${WEB}src`, { recursive: true, encoding: "utf8" })
    .filter((file) => /\.(css|ts|tsx|html)$/.test(file))
    .filter(
      (file) =>
        !file.startsWith("gen/") && file !== "theme/fontSources.test.ts",
    )
    .map((file) => `src/${file}`),
];

describe("bundled fonts", () => {
  test("fonts_noFileNamesGoogleFonts", () => {
    const named = files.filter((file) =>
      /fonts\.(googleapis|gstatic)\.com/.test(readFileSync(WEB + file, "utf8")),
    );

    expect(files.length).toBeGreaterThan(40);
    expect(named).toEqual([]);
  });

  test("fonts_everyFaceInTheThemeIsImported", () => {
    const main = readFileSync(`${WEB}src/main.tsx`, "utf8");

    [
      "@fontsource/ibm-plex-sans/",
      "@fontsource/ibm-plex-mono/",
      "@fontsource-variable/newsreader/",
      "@fontsource/nunito/",
      "@fontsource/tiro-devanagari-sanskrit/",
    ].forEach((source) => expect(main).toContain(source));
  });
});
