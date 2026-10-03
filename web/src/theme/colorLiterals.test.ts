/// <reference types="node" />
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { colorsInCss, colorsInScript } from "./colorLiterals";

// Every source file in web/src, read from disk. Vitest returns CSS as empty
// text through Vite, so the test reads the files itself.
// Vitest runs from web/.
const SRC = `${process.cwd()}/src/`;
const sources: Record<string, string> = Object.fromEntries(
  readdirSync(SRC, { recursive: true, encoding: "utf8" })
    .filter((file) => /\.(css|ts|tsx)$/.test(file) && !file.startsWith("gen/"))
    .map((file) => [`/src/${file}`, readFileSync(SRC + file, "utf8")]),
);

const isThemeFile = (path: string) => path.startsWith("/src/theme/");

describe("the theme rule", () => {
  test("theme_sourceFiles_haveNoColorValueOutsideTheTheme", () => {
    const found = Object.entries(sources)
      .filter(([path]) => !isThemeFile(path))
      .map(([path, text]) => [
        path,
        path.endsWith(".css") ? colorsInCss(text) : colorsInScript(text),
      ])
      .filter(([, colors]) => colors.length > 0);

    expect(Object.keys(sources).length).toBeGreaterThan(40);
    expect(found).toEqual([]);
  });

  test("theme_everyTokenInUse_isDefined", () => {
    const all = Object.values(sources).join("\n");
    const defined = new Set(
      [...all.matchAll(/(?:^|[\s{;"'])(--[a-z0-9-]+)\s*["']?\s*:/g)].map(
        (match) => match[1],
      ),
    );
    const used = new Set(
      [...all.matchAll(/var\((--[a-z0-9-]+)/g)].map((match) => match[1]),
    );

    expect([...used].filter((token) => !defined.has(token)).sort()).toEqual([]);
  });

  test("theme_componentFiles_readNoPaletteToken", () => {
    const theme = Object.entries(sources)
      .filter(([path]) => path === "/src/theme/default.css")
      .map(([, text]) => text)
      .join("");
    const palette = theme
      .slice(theme.indexOf("/* Palette */"), theme.indexOf("/* Mode screens"))
      .match(/--[a-z0-9-]+(?=:)/g);
    const components = Object.entries(sources)
      .filter(([path]) => !isThemeFile(path))
      .map(([, text]) => text)
      .join("\n");

    expect(palette?.length).toBeGreaterThan(10);
    expect(
      palette?.filter((token) => components.includes(`var(${token})`)),
    ).toEqual([]);
  });
});

describe("colorsInCss", () => {
  test.each([
    ["a { color: #fff; }", ["#fff"]],
    ["a { background: #1a1a17aa; }", ["#1a1a17aa"]],
    ["a { box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2); }", ["rgba("]],
    ["a { border: 1px solid white; }", ["white"]],
    ["a { color: hsl(10 20% 30%); }", ["hsl("]],
    ["a { color: var(--ink); }", []],
    [
      "a { background: color-mix(in srgb, var(--mode) 14%, var(--panel)); }",
      [],
    ],
    ["/* #fff white */ a { color: var(--ink); }", []],
    ["#tree a, .red-row { color: var(--ink); }", []],
    ["a { fill: currentColor; background: transparent; }", []],
  ])("colorsInCss_%j_finds%j", (css, expected) => {
    expect(colorsInCss(css)).toEqual(expected);
  });
});

describe("colorsInScript", () => {
  test.each([
    ['<path fill="#000" />', ["#000"]],
    ['<svg stroke="white" />', ["white"]],
    ["const style = { color: 'red' };", ["red"]],
    ['<div style={{ background: "rgba(1,2,3,0.5)" }} />', ["rgba("]],
    ['<path stroke="currentColor" fill="none" />', []],
    ['<svg stroke="var(--accent)" />', []],
    ['<a href="#tree">Tree</a>', []],
    ['const label = "Shades of red and white";', []],
    ['// fill="#fff" in a comment', []],
  ])("colorsInScript_%j_finds%j", (source, expected) => {
    expect(colorsInScript(source)).toEqual(expected);
  });
});
