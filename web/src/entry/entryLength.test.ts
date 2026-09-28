import { expect, test } from "vitest";
import { isEntryLength } from "./entryLength";

test.each([
  ["1", true],
  ["40", true],
  ["1440", true],
  [" 25 ", true],
  ["0", false],
  ["1441", false],
  ["", false],
  ["12.5", false],
  ["-5", false],
  ["1e2", false],
])("isEntryLength_%j_is%s", (text, expected) => {
  expect(isEntryLength(text)).toBe(expected);
});
