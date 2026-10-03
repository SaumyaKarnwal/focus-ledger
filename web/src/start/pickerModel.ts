import { dayRange, formatSince } from "../ledger/period";
import {
  cycleStart,
  isInbox,
  isLogged,
  type LoggedMode,
  periodTotals,
  totalsOf,
} from "../ledger/rollup";
import { formatMinutes, type TodayData, todayModel } from "../today/todayModel";

export type PickerRow = {
  nodeId: string;
  name: string;
  /** "Harbour / Backend · 12m ago" */
  detail: string;
  /** "3h 20m / 6h 20m", or the logged time alone without an estimate. */
  figure: string;
  /** The mode of the latest logged cycle, for the bar. */
  mode: LoggedMode | undefined;
};

/** Open tasks, most recently worked first, that match `query` in the name or the path. */
export function pickerRows(
  data: TodayData,
  now: Date,
  timeZone: string,
  query: string,
): PickerRow[] {
  const needle = query.trim().toLowerCase();
  return todayModel(data, now, timeZone)
    .rail.map((row): PickerRow => {
      const node = data.allTimeNodes.find((listed) => listed.id === row.nodeId);
      const cycles = (node?.cycles ?? []).filter(isLogged);
      const logged = totalsOf(cycles).minutes;
      const planned = (node?.estimates ?? []).reduce(
        (sum, estimate) => sum + estimate.cycleCount * estimate.cycleMinutes,
        0,
      );
      const latest = [...cycles].sort(
        (left, right) =>
          cycleStart(right).getTime() - cycleStart(left).getTime(),
      )[0];
      const since = row.worked
        ? formatSince(row.lastActivity, now, timeZone)
        : "no cycles yet";
      return {
        nodeId: row.nodeId,
        name: row.name,
        detail: [
          ...(row.path.length > 0 ? [row.path.join(" / ")] : []),
          since,
        ].join(" · "),
        figure:
          planned > 0
            ? `${formatMinutes(logged)} / ${formatMinutes(planned)}`
            : formatMinutes(logged),
        mode: latest?.mode,
      };
    })
    .filter(
      (row) =>
        needle === "" ||
        row.name.toLowerCase().includes(needle) ||
        row.detail.toLowerCase().includes(needle),
    );
}

/** The mode of the latest logged Inbox cycle, for the "Not sure yet" bar. */
export function inboxMode(data: TodayData): LoggedMode | undefined {
  return data.allTimeNodes
    .filter(isInbox)
    .flatMap((node) => node.cycles)
    .filter(isLogged)
    .sort(
      (left, right) => cycleStart(right).getTime() - cycleStart(left).getTime(),
    )[0]?.mode;
}

/** Minutes logged today in the Inbox, for the "Not sure yet" row. */
export function inboxMinutesToday(
  data: TodayData,
  now: Date,
  timeZone: string,
): number {
  return periodTotals(data.weekNodes.filter(isInbox), dayRange(now, timeZone))
    .minutes;
}
