import type { Ledger } from "../api/ledger";
import { toPeriodPb, weekRange } from "../ledger/period";
import type { TodayData } from "./todayModel";

export async function loadToday(
  client: Ledger,
  now: Date,
  timeZone: string,
): Promise<TodayData> {
  const week = weekRange(now, timeZone);
  const [account, settingsResponse, allTime, thisWeek] = await Promise.all([
    client.getAccount({}),
    client.getSettings({}),
    client.listNodes({}),
    // Closed nodes keep their time in the totals (FR-7.7).
    client.listNodes({ period: toPeriodPb(week), includeClosed: true }),
  ]);
  if (!settingsResponse.settings)
    throw new Error("GetSettings sent no settings");
  return {
    email: account.account?.email ?? "",
    settings: settingsResponse.settings,
    allTimeNodes: allTime.nodes,
    weekNodes: thisWeek.nodes,
    week,
  };
}
