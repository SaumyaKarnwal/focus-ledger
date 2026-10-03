import { isInbox, totalsOf } from "../ledger/rollup";
import { formatMinutes, pathOf, type TodayData } from "../today/todayModel";

export type TaskStrip = {
  name: string;
  path: string[];
  /** "3h 20m of 6h 20m planned", or the time so far when there is no estimate. */
  timeLine: string;
};

/** The bottom strip for a task. Undefined for the Inbox, which shows the empty strip. */
export function taskStrip(
  data: TodayData,
  nodeId: string,
): TaskStrip | undefined {
  const node = data.allTimeNodes.find(
    (listed) => !isInbox(listed) && listed.id === nodeId,
  );
  if (!node) return undefined;
  const logged = totalsOf(node.cycles).minutes;
  const planned = node.estimates.reduce(
    (sum, estimate) => sum + estimate.cycleCount * estimate.cycleMinutes,
    0,
  );
  return {
    name: node.name,
    path: pathOf(node, data.allTimeNodes),
    timeLine:
      planned > 0
        ? `${formatMinutes(logged)} of ${formatMinutes(planned)} planned`
        : `${formatMinutes(logged)} so far`,
  };
}
