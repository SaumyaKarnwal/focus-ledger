import { describe, expect, test } from "vitest";
import { type Address, parseAddress, pathOf } from "./addresses";

describe("addresses", () => {
  test.each<[string, Address]>([
    ["/", { view: "today" }],
    ["/tasks", { view: "tree" }],
    ["/tasks/", { view: "tree" }],
    [
      "/tasks/00000000-0000-4000-8000-00000000000a",
      {
        view: "tree",
        taskId: "00000000-0000-4000-8000-00000000000a",
      },
    ],
    ["/settings", { view: "settings" }],
    ["/report", { view: "report" }],
  ])("parseAddress_%s_isItsPage", (path, address) => {
    expect(parseAddress(path)).toEqual(address);
    expect(parseAddress(pathOf(address))).toEqual(address);
  });

  test.each([
    "/start",
    "/tasks/a/b",
    "/settings/x",
    "/index.html",
    "/report/2026",
  ])("parseAddress_%s_isUnknown", (path) => {
    expect(parseAddress(path)).toBeUndefined();
  });
});
