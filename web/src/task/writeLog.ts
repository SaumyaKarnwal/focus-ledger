import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import type { Ledger } from "../api/ledger";
import { withRetry } from "../api/retry";
import type { LogEntry } from "./logTimeModel";

/**
 * Writes each entry as a hand entry: CreateCycle with minutes set (FR-8). One
 * call after another, so a failure leaves the earlier ones written. A retry
 * sends the same request IDs, and the server returns the rows it already made.
 */
export async function writeLog(
  client: Ledger,
  entries: readonly LogEntry[],
  retryDelaysMs?: readonly number[],
): Promise<void> {
  for (const entry of entries) {
    await withRetry(
      () =>
        client.createCycle({
          requestId: entry.requestId,
          nodeId: entry.nodeId,
          mode: entry.mode,
          plannedMinutes: entry.minutes,
          minutes: entry.minutes,
          startedAt: timestampFromDate(entry.startedAt),
        }),
      retryDelaysMs,
    );
  }
}
