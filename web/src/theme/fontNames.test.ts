/// <reference types="node" />
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

// Every source file in web/src, read from disk, as in colorLiterals.test.ts.
const SRC = `${process.cwd()}/src/`;
const sources = readdirSync(SRC, { recursive: true, encoding: "utf8" })
  .filter((file) => /\.(css|ts|tsx)$/.test(file) && !file.startsWith("gen/"))
  .filter((file) => !file.startsWith("theme/"))
  .map((file) => ({ file, text: readFileSync(SRC + file, "utf8") }));

describe("the bundled faces", () => {
  const theme = readFileSync(`${SRC}theme/default.css`, "utf8");
  const stack = (token: string) =>
    new RegExp(`--font-${token}:\\s*([^;]+);`).exec(theme)?.[1] ?? "";
  const main = readFileSync(`${SRC}main.tsx`, "utf8");

  test("theme_timerAndCtaStacks_startWithTheBundledFace", () => {
    expect(stack("timer")).toMatch(/^"Nunito",/);
    expect(stack("cta")).toMatch(/^Nunito,/);
    expect(theme).not.toContain("Arial Rounded");
    expect(main).toContain('import "@fontsource/nunito/700.css";');
    expect(main).toContain('import "@fontsource/nunito/800.css";');
  });
});

describe("the font rule", () => {
  test("theme_componentFiles_nameNoFontFamily", () => {
    const named = sources.flatMap(({ file, text }) =>
      [
        ...text.matchAll(/font-family\s*:\s*([^;}\n]+)/g),
        ...text.matchAll(/fontFamily\s*[:=]\s*["'{]([^"'}]+)/g),
        ...text.matchAll(/font-family="([^"]+)"/g),
      ]
        .map((match) => match[1].trim())
        .filter((value) => !/^var\(--font-[a-z]+\)$/.test(value))
        .filter((value) => value !== "inherit")
        .map((value) => `${file}: ${value}`),
    );

    expect(sources.length).toBeGreaterThan(40);
    expect(named).toEqual([]);
  });

  test("theme_timerAndCta_useTheirFontTokens", () => {
    const modeScreen =
      sources.find(({ file }) => file === "styles/modeScreen.css")?.text ?? "";
    const rule = (selector: string) =>
      modeScreen.slice(
        modeScreen.indexOf(`${selector} {`),
        modeScreen.indexOf("}", modeScreen.indexOf(`${selector} {`)),
      );

    expect(rule(".start-time")).toContain("font-family: var(--font-timer)");
    expect(rule(".start-time")).toContain("font-weight: 700;");
    expect(rule(".screen-cta")).toContain("font-family: var(--font-cta)");
    expect(rule(".screen-cta")).toContain("var(--screen-cta-ledge)");
  });
});
