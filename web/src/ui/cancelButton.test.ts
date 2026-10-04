/// <reference types="node" />
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

// Vitest runs from web/.
const SRC = `${process.cwd()}/src/`;
const components = readdirSync(SRC, { recursive: true, encoding: "utf8" })
  .filter(
    (file) =>
      file.endsWith(".tsx") &&
      !file.includes(".test.") &&
      !file.startsWith("gen/"),
  )
  .map((file) => ({ file, text: readFileSync(SRC + file, "utf8") }));

const cancelButtons = components.flatMap(({ file, text }) =>
  [
    ...text.matchAll(
      /<button\b((?:(?!<\/button>)[\s\S])*?)>\s*Cancel\s*<\/button>/g,
    ),
  ].map((match) => ({ file, attributes: match[1] })),
);

describe("the Cancel button (issue 221, board A-Signout)", () => {
  test("cancel_everyDialog_usesTheSharedTextButton", () => {
    expect(cancelButtons.map(({ file }) => file).sort()).toEqual([
      "start/SignOutConfirm.tsx",
      "task/TaskDialog.tsx",
      "taskPage/TaskPage.tsx",
    ]);
    expect(
      cancelButtons.filter(
        ({ attributes }) => !/className="cancel-button"/.test(attributes),
      ),
    ).toEqual([]);
  });
});
