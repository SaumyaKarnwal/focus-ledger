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
import type { LoggedMode } from "../ledger/rollup";
import { ModeRows } from "../modes/ModeRows";
import { INBOX_ID, pathOf, plannedMinutesFor } from "../today/todayModel";
import { useAction } from "../useAction";
import { isEntryLength, LENGTH_MESSAGE } from "./entryLength";

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
  const [lengthError, setLengthError] = useState<string>();
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
    if (!isEntryLength(minutes)) {
      setLengthError(LENGTH_MESSAGE);
      return;
    }
    setLengthError(undefined);
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

  const selectedNode = nodes.find((node) => node.id === nodeId);
  const path = selectedNode ? pathOf(selectedNode, nodes) : [];

  return (
    <div className="backdrop">
      <section
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
      >
        <div className="centre-title">
          {path.length > 0 && <span className="crumb">{path.join(" / ")}</span>}
          <h2 id={headingId} className="title title-m">
            {nodeName}
          </h2>
        </div>
        {(lengthError ?? error) && (
          <p className="alert" role="alert">
            {lengthError ?? error}
          </p>
        )}
        <form onSubmit={save}>
          <label className="field">
            <span className="label">Node</span>
            <select
              value={nodeId}
              onChange={(event) => setNodeId(event.target.value)}
            >
              <option value={INBOX_ID}>Inbox</option>
              {nodes.map((node) => (
                <option key={node.id} value={node.id}>
                  {[...pathOf(node, nodes), node.name].join(" / ")}
                </option>
              ))}
            </select>
          </label>
          <div className="dialog-block">
            <span className="label">What kind of thinking</span>
            <ModeRows
              selected={mode}
              onSelect={chooseMode}
              groupName={modeName}
              descriptions="short"
            />
          </div>
          <div className="fields-3">
            <label className="field">
              <span className="label">Date</span>
              <input
                className="text-input"
                type="date"
                value={date}
                required
                onChange={(event) => setDate(event.target.value)}
              />
            </label>
            <label className="field">
              <span className="label">Started</span>
              <input
                className="text-input"
                type="time"
                value={time}
                required
                onChange={(event) => setTime(event.target.value)}
              />
            </label>
            <label className="field">
              <span className="label">Length</span>
              <input
                className="text-input"
                type="number"
                inputMode="numeric"
                value={minutes}
                onChange={(event) => setMinutes(event.target.value)}
              />
            </label>
          </div>
          <div className="dialog-actions">
            <button type="button" className="button" onClick={onCancel}>
              Cancel
            </button>
            <button type="submit" className="button-primary" disabled={busy}>
              Log it
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
