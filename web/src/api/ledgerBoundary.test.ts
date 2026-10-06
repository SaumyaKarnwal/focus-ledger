/// <reference types="node" />
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

// Vitest runs from web/.
const SRC = `${process.cwd()}/src/`;
const screens = readdirSync(SRC, { recursive: true, encoding: "utf8" })
  .filter(
    (file) =>
      /\.(ts|tsx)$/.test(file) &&
      !/\.test\.tsx?$/.test(file) &&
      !file.startsWith("api/") &&
      !file.startsWith("testing/") &&
      !file.startsWith("gen/"),
  )
  .map((file) => ({ file, text: readFileSync(SRC + file, "utf8") }));

// A version of the ledger, or what builds one, stays inside api/.
const VERSIONS =
  /from "@connectrpc\/connect-web"|from "[./]*api\/(serverLedger|fakeLedgerService)"|\bcreateClient\b/;

describe("one ledger interface (README Guest mode)", () => {
  test("ledgerBoundary_noScreenImportsAVersionOfTheLedger", () => {
    expect(screens.length).toBeGreaterThan(40);
    expect(
      screens.filter(({ text }) => VERSIONS.test(text)).map(({ file }) => file),
    ).toEqual([]);
  });

  test("ledgerBoundary_onlyMainChoosesTheLedger", () => {
    expect(
      screens
        .filter(({ text }) => /from "[./]*api\/selectLedger"/.test(text))
        .map(({ file }) => file),
    ).toEqual(["main.tsx"]);
  });
});
