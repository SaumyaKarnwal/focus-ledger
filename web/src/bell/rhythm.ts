import { dayRange, isInRange } from "../ledger/period";
import { cycleStart, isLogged } from "../ledger/rollup";
import { knownCycles, type TodayData } from "../today/todayModel";

/**
 * Long break after every Nth logged cycle of the day (Settings, "Long break
 * every N cycles"). Inbox cycles count too.
 */
export function longBreakDue(
  data: TodayData,
  now: Date,
  timeZone: string,
  every: number,
): boolean {
  const today = dayRange(now, timeZone);
  const count = knownCycles(data).filter(
    (cycle) => isLogged(cycle) && isInRange(cycleStart(cycle), today),
  ).length;
  return count > 0 && count % every === 0;
}
