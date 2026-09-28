import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, test } from "vitest";
import { withRetry } from "./retry";

function failingThen<T>(failures: Code[], result: T) {
  const calls: number[] = [];
  const call = async () => {
    calls.push(calls.length);
    const code = failures[calls.length - 1];
    if (code !== undefined) throw new ConnectError("failed", code);
    return result;
  };
  return { call, calls };
}

describe("withRetry", () => {
  test("withRetry_unavailableThenSuccess_returnsTheResult", async () => {
    const { call, calls } = failingThen([Code.Unavailable], "cycle");

    expect(await withRetry(call, [0])).toBe("cycle");
    expect(calls).toHaveLength(2);
  });

  test("withRetry_failedPrecondition_doesNotRetry", async () => {
    const { call, calls } = failingThen([Code.FailedPrecondition], "cycle");

    await expect(withRetry(call, [0, 0])).rejects.toThrow("failed");
    expect(calls).toHaveLength(1);
  });

  test("withRetry_moreFailuresThanDelays_throwsTheLastError", async () => {
    const { call, calls } = failingThen(
      [Code.Unavailable, Code.DeadlineExceeded, Code.Unavailable],
      "cycle",
    );

    await expect(withRetry(call, [0, 0])).rejects.toThrow("failed");
    expect(calls).toHaveLength(3);
  });
});
