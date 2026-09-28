import { expect, test } from "vitest";
import { selectBackend } from "./ledgerClient";

test.each([
  ["", undefined, "real"],
  ["", "fake", "fake"],
  ["?backend=fake", undefined, "fake"],
  ["?backend=real", "fake", "real"],
  ["?backend=other", undefined, "real"],
])("selectBackend_search%j_flag%j_returns%s", (search, buildFlag, expected) => {
  expect(selectBackend(search, buildFlag)).toBe(expected);
});
