import { timestampDate } from "@bufbuild/protobuf/wkt";
import { create } from "@bufbuild/protobuf";
import {
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  useState,
} from "react";
import type { LedgerClient } from "../api/ledgerClient";
import { withRetry } from "../api/retry";
import { useRequestId } from "../api/useRequestId";
import { EntryDialog } from "../entry/EntryDialog";
import {
  type CyclePb,
  type EstimatePb,
  type NodePb,
  NodePbSchema,
  type SettingsPb,
} from "../gen/focusledger/v1/model_pb";
import { InboxList } from "../inbox/InboxList";
import { formatShortDate } from "../ledger/period";
import {
  cycleStart,
  isInbox,
  isLogged,
  LOGGED_MODES,
  type LoggedMode,
  overallTotals,
} from "../ledger/rollup";
import { ModeRows } from "../modes/ModeRows";
import { modeKey } from "../modes/modes";
import {
  formatMinutes,
  INBOX_ID,
  isClosedOrUnderClosed,
  MODE_NAMES,
  modeProgressOf,
} from "../today/todayModel";
import { PageHeader } from "../ui/PageHeader";
import { useAction } from "../useAction";
import { useListNodes } from "../useListNodes";
import {
  type EstimateRow,
  estimateRows,
  estimateSummary,
  toEstimates,
} from "./estimateModel";
import { buildTree, flattenTree, moveSummary, type TreeRow } from "./treeModel";
import type { ByMode } from "../ledger/rollup";

const TOP_LEVEL = "";

type Panel =
  | { kind: "view" }
  | { kind: "estimate"; rows: ByMode<EstimateRow> }
  | { kind: "move" }
  | { kind: "entry" };

type Props = {
  client: LedgerClient;
  settings: SettingsPb;
  timeZone: string;
  retryDelaysMs?: readonly number[];
  nav: ReactNode;
  onOpenOnToday: (nodeId: string) => void;
};

export function TreeScreen({
  client,
  settings,
  timeZone,
  retryDelaysMs,
  nav,
  onOpenOnToday,
}: Props) {
  // One call with closed nodes: the Tree filters them into the Closed section.
  const { nodes, loadError, reload } = useListNodes(
    client,
    true,
    retryDelaysMs,
  );
  const { busy, error, run } = useAction();
  const [selectedId, setSelectedId] = useState<string>();
  const [panel, setPanel] = useState<Panel>({ kind: "view" });
  const [renaming, setRenaming] = useState<string>();
  const [draft, setDraft] = useState<Draft>();
  const draftKey = useRequestId();
  const [showClosed, setShowClosed] = useState(false);

  const emptyEstimate = () => estimateRows(create(NodePbSchema), settings);
  const startDraft = (parentId?: string, parentName?: string) => {
    setDraft({ parentId, parentName, name: "", estimate: emptyEstimate() });
    setSelectedId(undefined);
    setPanel({ kind: "view" });
  };
  const saveDraft = (then?: (nodeId: string) => void) => {
    if (!draft) return;
    const content = {
      parentId: draft.parentId,
      name: draft.name,
      estimates: toEstimates(draft.estimate).filter(
        (row) => row.cycleCount > 0,
      ),
    };
    const request = { requestId: draftKey.requestIdFor(content), ...content };
    void run(async () => {
      const response = await withRetry(
        () => client.createNode(request),
        retryDelaysMs,
      );
      draftKey.done();
      setDraft(
        (current) =>
          current && { ...current, name: "", estimate: emptyEstimate() },
      );
      reload();
      if (then && response.node) then(response.node.id);
    });
  };
  const draftRow = (depth: number) =>
    draft && (
      <DraftRow
        draft={draft}
        depth={depth}
        busy={busy}
        onName={(name) => setDraft({ ...draft, name })}
        onSave={() => saveDraft()}
        onClose={() => setDraft(undefined)}
      />
    );

  const all = nodes ?? [];
  const openNodes = all.filter(
    (node) => !isInbox(node) && !isClosedOrUnderClosed(node, all),
  );
  const openIds = new Set(openNodes.map((node) => node.id));
  const rows = buildTree(openNodes);
  const closedTops = flattenTree(
    buildTree(all.filter((node) => !isInbox(node))),
  ).filter(
    (row) =>
      row.node.closed &&
      (row.node.parentId === undefined || openIds.has(row.node.parentId)),
  );
  const inboxCycles = all.filter(isInbox).flatMap((node) => node.cycles);
  const totals = overallTotals(all);
  const loggedCount = all
    .flatMap((node) => node.cycles)
    .filter(isLogged).length;
  const selectedRow = [...flattenTree(rows), ...closedTops].find(
    (row) => row.node.id === selectedId,
  );

  const select = (nodeId: string) => {
    setSelectedId(nodeId);
    setPanel({ kind: "view" });
    setRenaming(undefined);
    setDraft(undefined);
  };

  const write = async (call: () => Promise<unknown>) => {
    const succeeded = await run(async () => {
      await withRetry(call, retryDelaysMs);
    });
    if (succeeded) reload();
    return succeeded;
  };

  const update = (
    nodeId: string,
    fields: Partial<Pick<NodePb, "name" | "parentId" | "closed">> & {
      estimates?: Pick<EstimatePb, "mode" | "cycleMinutes" | "cycleCount">[];
    },
    path: string,
  ) =>
    write(() =>
      client.updateNode({ nodeId, ...fields, updateMask: { paths: [path] } }),
    );

  const file = (cycle: CyclePb, nodeId: string) =>
    void run(async () => {
      try {
        await withRetry(
          () =>
            client.updateCycle({
              cycleId: cycle.id,
              nodeId,
              updateMask: { paths: ["node_id"] },
            }),
          retryDelaysMs,
        );
      } finally {
        reload();
      }
    });

  const renderRow = (row: TreeRow, depth: number) => {
    const { node, rollUp } = row;
    const isSelected = selectedId === node.id;
    const hasChildren = row.children.length > 0;
    return (
      <li key={node.id} aria-label={node.name}>
        <div
          className="tree-row"
          data-selected={isSelected}
          data-root={depth === 0}
          style={{ "--depth": depth } as CSSProperties}
        >
          <span className="tree-row-name">
            {renaming === node.id ? (
              <NameInput
                label={`New name for ${node.name}`}
                initial={node.name}
                busy={busy}
                onSave={async (name) => {
                  if (await update(node.id, { name }, "name")) {
                    setRenaming(undefined);
                  }
                }}
                onCancel={() => setRenaming(undefined)}
              />
            ) : (
              <button
                type="button"
                data-part="name"
                aria-pressed={isSelected}
                onClick={() => select(node.id)}
              >
                {node.name}
              </button>
            )}
            {node.closed && (
              <span className="hint" data-part="closed">
                (closed)
              </span>
            )}
            {hasChildren && rollUp.own.minutes > 0 && (
              <span className="chip">
                {formatMinutes(rollUp.own.minutes)} here
              </span>
            )}
            {hasChildren && rollUp.own.minutes === 0 && (
              <span className="hint">no time of its own</span>
            )}
          </span>
          <span className="tree-col-count" data-part="count">
            {rollUp.rolledUp.doneCycles}
            <span className="muted">
              {" "}
              /{" "}
              {rollUp.rolledUp.estimatedCycles > 0
                ? rollUp.rolledUp.estimatedCycles
                : "—"}
            </span>
          </span>
          <span className="tree-col-time" data-part="time">
            {formatMinutes(rollUp.rolledUp.minutes)}
          </span>
          <span className="tree-col-actions">
            {openIds.has(node.id) && (
              <button
                type="button"
                className="icon-button"
                aria-label={`Add a child of ${node.name}`}
                onClick={() => startDraft(node.id, node.name)}
              >
                +
              </button>
            )}
          </span>
        </div>
        {(hasChildren || draft?.parentId === node.id) && (
          <ul className="tree-list">
            {row.children.map((child) => renderRow(child, depth + 1))}
            {draft?.parentId === node.id && draftRow(depth + 1)}
          </ul>
        )}
      </li>
    );
  };

  return (
    <>
      <PageHeader
        framed
        middle={nav}
        end={
          <span className="topbar-meta">
            {loggedCount} cycles · {formatMinutes(totals.minutes)}
          </span>
        }
      />
      <div className="tree-page">
        <section className="tree-main" aria-labelledby="tree-heading">
          <h2 id="tree-heading" className="visually-hidden">
            Tree
          </h2>
          {(error ?? loadError) && (
            <p className="alert page-alert" role="alert">
              {error ?? loadError}
            </p>
          )}
          <div className="tree-columns">
            <span className="label">Open</span>
            <span className="label tree-col-count">done / est</span>
            <span className="label tree-col-time">time</span>
            <span className="tree-col-actions" />
          </div>
          {nodes === undefined && !loadError && (
            <p className="note tree-note">Loading…</p>
          )}
          <ul className="tree-list" aria-label="Nodes">
            {rows.map((row) => renderRow(row, 0))}
            {draft && draft.parentId === undefined && draftRow(0)}
            <li aria-label="Inbox">
              <div
                className="tree-row"
                data-root="true"
                data-selected={selectedId === INBOX_ID}
              >
                <span className="tree-row-name">
                  <button
                    type="button"
                    data-part="name"
                    aria-pressed={selectedId === INBOX_ID}
                    onClick={() => select(INBOX_ID)}
                  >
                    Inbox
                  </button>
                  <span className="hint">cycles started without a task</span>
                </span>
                <span className="tree-col-count" data-part="count">
                  {inboxCycles.filter(isLogged).length}
                  <span className="faint"> / —</span>
                </span>
                <span className="tree-col-time" data-part="time">
                  {formatMinutes(
                    inboxCycles
                      .filter(isLogged)
                      .reduce((sum, cycle) => sum + (cycle.minutes ?? 0), 0),
                  )}
                </span>
                <span className="tree-col-actions">
                  <button
                    type="button"
                    className="button button-small"
                    onClick={() => select(INBOX_ID)}
                  >
                    Re-file
                  </button>
                </span>
              </div>
            </li>
          </ul>
          {!(draft && draft.parentId === undefined) && (
            <button
              type="button"
              className="button tree-add"
              onClick={() => startDraft()}
            >
              Add a top-level node
            </button>
          )}
          <button
            type="button"
            className="closed-toggle"
            aria-expanded={showClosed}
            onClick={() => setShowClosed((shown) => !shown)}
          >
            <span className="label">Closed · {closedTops.length}</span>
            <span className="mono muted">
              {formatMinutes(
                closedTops.reduce(
                  (sum, row) => sum + row.rollUp.rolledUp.minutes,
                  0,
                ),
              )}{" "}
              kept in the report
            </span>
          </button>
          {showClosed && (
            <ul className="tree-list" aria-label="Closed nodes">
              {closedTops.map((row) => renderRow({ ...row, children: [] }, 0))}
            </ul>
          )}
          <p className="note tree-note">
            Time attaches to any node, the root included. A node&rsquo;s total
            is always its own cycles plus everything beneath it, so nothing is
            counted twice.
          </p>
        </section>

        <aside className="detail" aria-label="Node detail">
          {draft ? (
            <DraftDetail
              draft={draft}
              busy={busy}
              onEstimate={(estimate) => setDraft({ ...draft, estimate })}
              onSave={() => saveDraft()}
              onSaveAndOpen={() => saveDraft(onOpenOnToday)}
              onClose={() => setDraft(undefined)}
            />
          ) : selectedId === INBOX_ID ? (
            <>
              <div className="detail-head">
                <span className="note">Cycles started without a task</span>
                <h2 className="title title-l">Inbox</h2>
              </div>
              <InboxList
                cycles={inboxCycles}
                targets={openNodes}
                timeZone={timeZone}
                busy={busy}
                onFile={file}
              />
            </>
          ) : selectedRow ? (
            <NodeDetail
              row={selectedRow}
              panel={panel}
              settings={settings}
              timeZone={timeZone}
              busy={busy}
              isOpen={openIds.has(selectedRow.node.id)}
              moveTargets={flattenTree(rows).filter(
                (other) => !flattenTree([selectedRow]).includes(other),
              )}
              onPanel={setPanel}
              onRename={() => setRenaming(selectedRow.node.id)}
              onToggleClosed={() =>
                void update(
                  selectedRow.node.id,
                  { closed: !selectedRow.node.closed },
                  "closed",
                )
              }
              onSaveEstimate={async (estimates) => {
                if (
                  await update(selectedRow.node.id, { estimates }, "estimates")
                ) {
                  setPanel({ kind: "view" });
                }
              }}
              onMove={async (parentId) => {
                if (
                  await update(selectedRow.node.id, { parentId }, "parent_id")
                ) {
                  setPanel({ kind: "view" });
                }
              }}
              onOpenOnToday={() => onOpenOnToday(selectedRow.node.id)}
            />
          ) : (
            <p className="note">
              Select a node to see its cycles and estimate.
            </p>
          )}
        </aside>
      </div>
      {panel.kind === "entry" && selectedRow && (
        <EntryDialog
          client={client}
          settings={settings}
          nodes={openNodes}
          initialNodeId={selectedRow.node.id}
          timeZone={timeZone}
          retryDelaysMs={retryDelaysMs}
          onSaved={() => {
            setPanel({ kind: "view" });
            reload();
          }}
          onCancel={() => setPanel({ kind: "view" })}
        />
      )}
    </>
  );
}

function NodeDetail({
  row,
  panel,
  settings,
  timeZone,
  busy,
  isOpen,
  moveTargets,
  onPanel,
  onRename,
  onToggleClosed,
  onSaveEstimate,
  onMove,
  onOpenOnToday,
}: {
  row: TreeRow;
  panel: Panel;
  settings: SettingsPb;
  timeZone: string;
  busy: boolean;
  isOpen: boolean;
  moveTargets: TreeRow[];
  onPanel: (panel: Panel) => void;
  onRename: () => void;
  onToggleClosed: () => void;
  onSaveEstimate: (estimates: ReturnType<typeof toEstimates>) => void;
  onMove: (parentId: string | undefined) => void;
  onOpenOnToday: () => void;
}) {
  const { node, rollUp } = row;
  const progress = modeProgressOf(node);
  const ownCycles = node.cycles
    .filter(isLogged)
    .sort(
      (left, right) => cycleStart(right).getTime() - cycleStart(left).getTime(),
    );
  const since = node.createdAt
    ? formatShortDate(timestampDate(node.createdAt), timeZone)
    : undefined;

  return (
    <>
      <div className="detail-head">
        <span className="note">
          {node.closed ? "Closed · " : ""}
          {row.children.length === 1
            ? "1 child"
            : `${row.children.length} children`}
          {since ? ` · since ${since}` : ""}
        </span>
        <h2 className="title title-l">{node.name}</h2>
        <div className="detail-times">
          <span className="detail-time">
            <span className="mono">{formatMinutes(rollUp.own.minutes)}</span>
            <span className="label">here</span>
          </span>
          <span className="detail-divider" aria-hidden="true" />
          <span className="detail-time">
            <span className="mono">
              {formatMinutes(rollUp.rolledUp.minutes)}
            </span>
            <span className="label">with children</span>
          </span>
        </div>
      </div>

      {panel.kind === "estimate" ? (
        <section
          className="detail-section"
          aria-label={`Estimate for ${node.name}`}
        >
          <div className="section-head">
            <h3 className="label">Estimate</h3>
            <span className="label">length × cycles</span>
          </div>
          <ModeRows
            estimate={{
              rows: panel.rows,
              onChange: (rows) => onPanel({ kind: "estimate", rows }),
            }}
          />
          <div className="estimate-summary">
            <span className="note">A guess is enough.</span>
            <span className="mono" aria-label="Estimate summary">
              {estimateSummary(panel.rows).cycles} cycles ·{" "}
              {formatMinutes(estimateSummary(panel.rows).minutes)}
            </span>
          </div>
          <div className="detail-actions">
            <button
              type="button"
              className="button-primary"
              disabled={busy}
              onClick={() => onSaveEstimate(toEstimates(panel.rows))}
            >
              Save estimate
            </button>
            <button
              type="button"
              className="button"
              onClick={() => onPanel({ kind: "view" })}
            >
              Cancel
            </button>
          </div>
        </section>
      ) : (
        <section className="detail-section">
          <div className="section-head">
            <h3 className="label">
              Estimate · {rollUp.own.estimatedCycles} cycles
            </h3>
            <button
              type="button"
              className="link-button"
              onClick={() =>
                onPanel({
                  kind: "estimate",
                  rows: estimateRows(node, settings),
                })
              }
            >
              Edit estimate
            </button>
          </div>
          {LOGGED_MODES.map((mode) => (
            <EstimateLine key={mode} mode={mode} counts={progress[mode]} />
          ))}
          <p className="note">
            An estimate covers only the cycles logged on this node, not its
            children.
          </p>
        </section>
      )}

      {panel.kind === "move" && (
        <MovePicker
          row={row}
          targets={moveTargets}
          busy={busy}
          onMove={onMove}
          onCancel={() => onPanel({ kind: "view" })}
        />
      )}

      <section className="detail-section">
        <div className="section-head">
          <h3 className="label">Its own cycles · {ownCycles.length}</h3>
          {isOpen && (
            <button
              type="button"
              className="link-button"
              onClick={() => onPanel({ kind: "entry" })}
            >
              + Add an entry
            </button>
          )}
        </div>
        {ownCycles.length === 0 ? (
          <p className="note">No cycles yet.</p>
        ) : (
          <ul className="cycle-list" aria-label="Its own cycles">
            {ownCycles.map((cycle) => (
              <li
                key={cycle.id}
                className="cycle-row"
                data-mode={modeKey(cycle.mode)}
              >
                <span className="mode-bar" aria-hidden="true" />
                <span className="cycle-row-name">
                  {MODE_NAMES[cycle.mode as LoggedMode]}
                </span>
                <span className="cycle-row-time">
                  {formatShortDate(cycleStart(cycle), timeZone)}
                </span>
                <span className="cycle-row-minutes">{cycle.minutes}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="detail-actions">
        {isOpen && (
          <button type="button" className="button" onClick={onOpenOnToday}>
            Open on Today
          </button>
        )}
        <button type="button" className="button" onClick={onRename}>
          Rename
        </button>
        {isOpen && (
          <button
            type="button"
            className="button"
            onClick={() => onPanel({ kind: "move" })}
          >
            Move to…
          </button>
        )}
        <button
          type="button"
          className="button"
          disabled={busy}
          onClick={onToggleClosed}
        >
          {node.closed ? "Reopen" : "Close"}
        </button>
      </div>
    </>
  );
}

function EstimateLine({
  mode,
  counts,
}: {
  mode: LoggedMode;
  counts: { doneCycles: number; estimatedCycles: number };
}) {
  const { doneCycles, estimatedCycles } = counts;
  const over =
    estimatedCycles > 0
      ? Math.round(((doneCycles - estimatedCycles) / estimatedCycles) * 100)
      : undefined;
  return (
    <div className="detail-estimate-row" data-mode={modeKey(mode)}>
      <span className="mode-bar" aria-hidden="true" />
      <span className="detail-estimate-text">
        <span className="mode-row-name">{MODE_NAMES[mode]}</span>
        <span className="mono muted">
          {estimatedCycles} est · {doneCycles} done
          {over !== undefined && over !== 0 && (
            <>
              {" · "}
              <span>{over > 0 ? `+${over}%` : `${over}%`}</span>
            </>
          )}
        </span>
      </span>
    </div>
  );
}

function NameInput({
  label,
  initial,
  busy,
  onSave,
  onCancel,
}: {
  label: string;
  initial: string;
  busy: boolean;
  onSave: (name: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial);
  const keyDown = (event: KeyboardEvent) => {
    if (event.key === "Enter" && !busy) onSave(name);
    if (event.key === "Escape") onCancel();
  };
  return (
    <input
      className="tree-name-input"
      aria-label={label}
      value={name}
      autoFocus
      onChange={(event) => setName(event.target.value)}
      onKeyDown={keyDown}
    />
  );
}

/** A node being typed in. Its estimate is edited in the detail panel. */
type Draft = {
  parentId: string | undefined;
  parentName: string | undefined;
  name: string;
  estimate: ByMode<EstimateRow>;
};

/** Enter saves the node and keeps the input open for the next sibling. Escape closes it. */
function DraftRow({
  draft,
  depth,
  busy,
  onName,
  onSave,
  onClose,
}: {
  draft: Draft;
  depth: number;
  busy: boolean;
  onName: (name: string) => void;
  onSave: () => void;
  onClose: () => void;
}) {
  const keyDown = (event: KeyboardEvent) => {
    if (event.key === "Enter" && !busy) onSave();
    if (event.key === "Escape") onClose();
  };
  return (
    <li>
      <div
        className="tree-row tree-new-row"
        style={{ "--depth": depth } as CSSProperties}
      >
        <input
          className="tree-name-input"
          aria-label={
            draft.parentName
              ? `New node under ${draft.parentName}`
              : "New top-level node"
          }
          value={draft.name}
          autoFocus
          onChange={(event) => onName(event.target.value)}
          onKeyDown={keyDown}
        />
        <span className="chip">
          {draft.parentName
            ? `new child of ${draft.parentName}`
            : "new top-level node"}
        </span>
        <span className="note">
          Enter saves and opens a sibling · Esc closes
        </span>
      </div>
    </li>
  );
}

function DraftDetail({
  draft,
  busy,
  onEstimate,
  onSave,
  onSaveAndOpen,
  onClose,
}: {
  draft: Draft;
  busy: boolean;
  onEstimate: (estimate: ByMode<EstimateRow>) => void;
  onSave: () => void;
  onSaveAndOpen: () => void;
  onClose: () => void;
}) {
  const summary = estimateSummary(draft.estimate);
  return (
    <>
      <div className="detail-head">
        <span className="note">
          New node
          {draft.parentName
            ? ` · child of ${draft.parentName}`
            : " · top level"}
        </span>
        <h2 className="title title-l">{draft.name || "New node"}</h2>
        <span className="note">No cycles yet.</span>
      </div>
      <section
        className="detail-section"
        aria-label="Estimate for the new node"
      >
        <div className="section-head">
          <h3 className="label">Estimate</h3>
          <span className="label">length × cycles</span>
        </div>
        <ModeRows estimate={{ rows: draft.estimate, onChange: onEstimate }} />
        <div className="estimate-summary">
          <span className="note">A guess is enough.</span>
          <span className="mono">
            {summary.cycles} cycles · {formatMinutes(summary.minutes)}
          </span>
        </div>
      </section>
      <div className="detail-actions">
        <button
          type="button"
          className="button-primary"
          disabled={busy}
          onClick={onSave}
        >
          Add
        </button>
        <button
          type="button"
          className="button"
          disabled={busy}
          onClick={onSaveAndOpen}
        >
          Add and open on Today
        </button>
        <button type="button" className="button" onClick={onClose}>
          Done
        </button>
      </div>
    </>
  );
}

function MovePicker({
  row,
  targets,
  busy,
  onMove,
  onCancel,
}: {
  row: TreeRow;
  targets: TreeRow[];
  busy: boolean;
  onMove: (parentId: string | undefined) => void;
  onCancel: () => void;
}) {
  const [target, setTarget] = useState(row.node.parentId ?? TOP_LEVEL);
  const summary = moveSummary(row);
  return (
    <section className="move-picker" aria-label={`Move ${row.node.name}`}>
      <label className="field">
        <span className="label">Move {row.node.name} under</span>
        <select
          value={target}
          onChange={(event) => setTarget(event.target.value)}
        >
          <option value={TOP_LEVEL}>Top level</option>
          {targets.map((other) => (
            <option key={other.node.id} value={other.node.id}>
              {[...other.path, other.node.name].join(" › ")}
            </option>
          ))}
        </select>
      </label>
      {summary && <p className="note">{summary}</p>}
      <div className="detail-actions">
        <button
          type="button"
          className="button-primary"
          disabled={busy}
          onClick={() => onMove(target === TOP_LEVEL ? undefined : target)}
        >
          Move
        </button>
        <button type="button" className="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </section>
  );
}
