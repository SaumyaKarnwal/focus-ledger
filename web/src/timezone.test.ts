import { expect, test } from "vitest";

test("testProcess_timeZone_isUtc", () => {
  expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe("UTC");
  expect(new Date(0).getTimezoneOffset()).toBe(0);
});
