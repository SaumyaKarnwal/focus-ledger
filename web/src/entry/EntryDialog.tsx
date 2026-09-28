import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { type FormEvent, useId, useState } from "react";
import type { LedgerClient } from "../api/ledgerClient";
import { withRetry } from "../api/retry";
import { useRequestId } from "../api/useRequestId";
import {
  FocusMode,
  type NodePb,
  type SettingsPb,
} from "../gen/focusledger/v1/model_pb";
import {
  localDateString,
  localTimeString,
  zonedDateTimeToInstant,
} from "../ledger/period";
import { LOGGED_MODES, type LoggedMode } from "../ledger/rollup";
import { INBOX_ID, MODE_NAMES, plannedMinutesFor } from "../today/todayModel";
import { useAction } from "../useAction";

type Props = {
  client: LedgerClient;
  settings: SettingsPb;
  /** The nodes that an entry can go to. The Inbox is always offered. */
  nodes: readonly NodePb[];
  initialNodeId: string;
  timeZone: string;
  retryDelaysMs?: readonly number[];
  onSaved: () => void;
  onCancel: () => void;
};

export function EntryDialog({
  client,
  settings,
  nodes,
  initialNodeId,
  timeZone,
  retryDelaysMs,
  onSaved,
  onCancel,
}: Props) {
  const headingId = useId();
  const modeName = useId();
  const { busy, error, run } = useAction();
  const { requestIdFor, done } = useRequestId();
  const [nodeId, setNodeId] = useState(initialNodeId);
  const [mode, setMode] = useState<LoggedMode>(FocusMode.DEEP_FOCUS);
  const [minutes, setMinutes] = useState(() =>
    String(plannedMinutesFor(settings, FocusMode.DEEP_FOCUS)),
  );
  const [date, setDate] = useState(() => localDateString(new Date(), timeZone));
  const [time, setTime] = useState(() => localTimeString(new Date(), timeZone));

  const nodeName = nodes.find((node) => node.id === nodeId)?.name ?? "Inbox";

  const chooseMode = (nextMode: LoggedMode) => {
    setMode(nextMode);
    setMinutes(String(plannedMinutesFor(settings, nextMode)));
  };

  const save = (event: FormEvent) => {
    event.preventDefault();
    const content = {
      nodeId: nodeId === INBOX_ID ? undefined : nodeId,
      mode,
      minutes: Number(minutes),
      plannedMinutes: 0,
      startedAt: timestampFromDate(
        zonedDateTimeToInstant(date, time, timeZone),
      ),
    };
    const request = { requestId: requestIdFor(content), ...content };
    void run(async () => {
      await withRetry(() => client.createCycle(request), retryDelaysMs);
      done();
      onSaved();
    });
  };

  return (
    <section role="dialog" aria-labelledby={headingId}>
      <h2 id={headingId}>{nodeName}</h2>
      {error && <p role="alert">{error}</p>}
      <form onSubmit={save}>
        <p>
          <label>
            Node{" "}
            <select
              value={nodeId}
              onChange={(event) => setNodeId(event.target.value)}
            >
              <option value={INBOX_ID}>Inbox</option>
              {nodes.map((node) => (
                <option key={node.id} value={node.id}>
                  {node.name}
                </option>
              ))}
            </select>
          </label>
        </p>
        <fieldset>
          <legend>Mode</legend>
          {LOGGED_MODES.map((option) => (
            <label key={option}>
              <input
                type="radio"
                name={modeName}
                checked={mode === option}
                onChange={() => chooseMode(option)}
              />
              {MODE_NAMES[option]}
            </label>
          ))}
        </fieldset>
        <p>
          <label>
            Date{" "}
            <input
              type="date"
              value={date}
              required
              onChange={(event) => setDate(event.target.value)}
            />
          </label>{" "}
          <label>
            Start time{" "}
            <input
              type="time"
              value={time}
              required
              onChange={(event) => setTime(event.target.value)}
            />
          </label>{" "}
          <label>
            Length in minutes{" "}
            <input
              type="number"
              inputMode="numeric"
              value={minutes}
              onChange={(event) => setMinutes(event.target.value)}
            />
          </label>
        </p>
        <button type="submit" disabled={busy}>
          Save entry
        </button>{" "}
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </form>
    </section>
  );
}
