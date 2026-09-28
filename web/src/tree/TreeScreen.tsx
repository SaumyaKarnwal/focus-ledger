import { type KeyboardEvent, useState } from "react";
import type { LedgerClient } from "../api/ledgerClient";
import { withRetry } from "../api/retry";
import { useRequestId } from "../api/useRequestId";
import { EntryDialog } from "../entry/EntryDialog";
import type {
  EstimatePb,
  NodePb,
  SettingsPb,
} from "../gen/focusledger/v1/model_pb";
import { formatMinutes, isClosedOrUnderClosed } from "../today/todayModel";
import { useAction } from "../useAction";
import { useListNodes } from "../useListNodes";
import { EstimateEditor } from "./EstimateEditor";
import { buildTree, flattenTree, moveSummary, type TreeRow } from "./treeModel";

const TOP_LEVEL = "";

type Editor =
  | { kind: "rename"; nodeId: string }
  | { kind: "create"; parentId: string | undefined }
  | { kind: "move"; nodeId: string }
  | { kind: "estimate"; nodeId: string }
  | { kind: "entry"; nodeId: string };

type Props = {
  client: LedgerClient;
  settings: SettingsPb;
  timeZone: string;
  retryDelaysMs?: readonly number[];
};

export function TreeScreen({
  client,
  settings,
  timeZone,
  retryDelaysMs,
}: Props) {
  const [showClosed, setShowClosed] = useState(false);
  const { nodes, loadError, reload } = useListNodes(
    client,
    showClosed,
    retryDelaysMs,
  );
  const { busy, error, run } = useAction();
  const [editor, setEditor] = useState<Editor>();

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

  const rows = nodes ? buildTree(nodes) : [];
  const openNodes = (nodes ?? []).filter(
    (node) => node.id !== "" && !isClosedOrUnderClosed(node, nodes ?? []),
  );

  const renderRow = (row: TreeRow) => {
    const { node, rollUp } = row;
    const active = editor && "nodeId" in editor && editor.nodeId === node.id;
    return (
      <li key={node.id} data-testid="tree-row" aria-label={node.name}>
        <span>{node.name}</span>
        {node.closed && <span> (closed)</span>}
        <span>
          {" "}
          · {rollUp.rolledUp.doneCycles} / {rollUp.rolledUp.estimatedCycles}
        </span>
        <span> · {formatMinutes(rollUp.rolledUp.minutes)}</span>{" "}
        <button
          type="button"
          onClick={() => setEditor({ kind: "rename", nodeId: node.id })}
        >
          Rename
        </button>{" "}
        <button
          type="button"
          onClick={() => setEditor({ kind: "create", parentId: node.id })}
        >
          Add child
        </button>{" "}
        <button
          type="button"
          onClick={() => setEditor({ kind: "move", nodeId: node.id })}
        >
          Move to…
        </button>{" "}
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void update(node.id, { closed: !node.closed }, "closed")
          }
        >
          {node.closed ? "Reopen" : "Close"}
        </button>{" "}
        <button
          type="button"
          onClick={() => setEditor({ kind: "estimate", nodeId: node.id })}
        >
          Estimate
        </button>{" "}
        <button
          type="button"
          onClick={() => setEditor({ kind: "entry", nodeId: node.id })}
        >
          Add an entry
        </button>
        {active && editor.kind === "rename" && (
          <NameInput
            label={`New name for ${node.name}`}
            initial={node.name}
            busy={busy}
            onSave={async (name) => {
              if (await update(node.id, { name }, "name")) setEditor(undefined);
            }}
            onCancel={() => setEditor(undefined)}
          />
        )}
        {active && editor.kind === "move" && (
          <MovePicker
            row={row}
            nodes={flattenTree(rows).filter(
              (other) => other.node.id !== node.id,
            )}
            busy={busy}
            onMove={async (parentId) => {
              if (await update(node.id, { parentId }, "parent_id")) {
                setEditor(undefined);
              }
            }}
            onCancel={() => setEditor(undefined)}
          />
        )}
        {active && editor.kind === "estimate" && (
          <EstimateEditor
            node={node}
            settings={settings}
            busy={busy}
            onSave={async (estimates) => {
              if (await update(node.id, { estimates }, "estimates")) {
                setEditor(undefined);
              }
            }}
            onCancel={() => setEditor(undefined)}
          />
        )}
        {active && editor.kind === "entry" && (
          <EntryDialog
            client={client}
            settings={settings}
            nodes={openNodes}
            initialNodeId={node.id}
            timeZone={timeZone}
            retryDelaysMs={retryDelaysMs}
            onSaved={() => {
              setEditor(undefined);
              reload();
            }}
            onCancel={() => setEditor(undefined)}
          />
        )}
        {editor?.kind === "create" && editor.parentId === node.id && (
          <NodeCreator
            client={client}
            parentId={node.id}
            parentName={node.name}
            retryDelaysMs={retryDelaysMs}
            onCreated={reload}
            onClose={() => setEditor(undefined)}
          />
        )}
        {row.children.length > 0 && <ul>{row.children.map(renderRow)}</ul>}
      </li>
    );
  };

  return (
    <section aria-labelledby="tree-heading">
      <h2 id="tree-heading">Tree</h2>
      <label>
        <input
          type="checkbox"
          checked={showClosed}
          onChange={(event) => setShowClosed(event.target.checked)}
        />{" "}
        Show closed nodes
      </label>
      {(error ?? loadError) && <p role="alert">{error ?? loadError}</p>}
      {nodes === undefined && !loadError && <p>Loading…</p>}
      <ul aria-label="Nodes">{rows.map(renderRow)}</ul>
      {editor?.kind === "create" && editor.parentId === undefined ? (
        <NodeCreator
          client={client}
          parentId={undefined}
          parentName={undefined}
          retryDelaysMs={retryDelaysMs}
          onCreated={reload}
          onClose={() => setEditor(undefined)}
        />
      ) : (
        <button
          type="button"
          onClick={() => setEditor({ kind: "create", parentId: undefined })}
        >
          Add a top-level node
        </button>
      )}
    </section>
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
    if (event.key === "Enter") onSave(name);
    if (event.key === "Escape") onCancel();
  };
  return (
    <p>
      <input
        aria-label={label}
        value={name}
        autoFocus
        onChange={(event) => setName(event.target.value)}
        onKeyDown={keyDown}
      />{" "}
      <button type="button" disabled={busy} onClick={() => onSave(name)}>
        Save
      </button>{" "}
      <button type="button" onClick={onCancel}>
        Cancel
      </button>
    </p>
  );
}

/** Enter saves the node and keeps the input open for the next sibling. Escape closes it. */
function NodeCreator({
  client,
  parentId,
  parentName,
  retryDelaysMs,
  onCreated,
  onClose,
}: {
  client: LedgerClient;
  parentId: string | undefined;
  parentName: string | undefined;
  retryDelaysMs?: readonly number[];
  onCreated: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const { busy, error, run } = useAction();
  const { requestIdFor, done } = useRequestId();

  const save = () => {
    const content = { parentId, name };
    const request = { requestId: requestIdFor(content), ...content };
    void run(async () => {
      await withRetry(() => client.createNode(request), retryDelaysMs);
      done();
      setName("");
      onCreated();
    });
  };
  const keyDown = (event: KeyboardEvent) => {
    if (event.key === "Enter" && !busy) save();
    if (event.key === "Escape") onClose();
  };

  return (
    <p>
      {error && <span role="alert">{error} </span>}
      <input
        aria-label={
          parentName ? `New node under ${parentName}` : "New top-level node"
        }
        value={name}
        autoFocus
        onChange={(event) => setName(event.target.value)}
        onKeyDown={keyDown}
      />{" "}
      <button type="button" disabled={busy} onClick={save}>
        Add
      </button>{" "}
      <button type="button" onClick={onClose}>
        Done
      </button>
    </p>
  );
}

function MovePicker({
  row,
  nodes,
  busy,
  onMove,
  onCancel,
}: {
  row: TreeRow;
  nodes: TreeRow[];
  busy: boolean;
  onMove: (parentId: string | undefined) => void;
  onCancel: () => void;
}) {
  const [target, setTarget] = useState(row.node.parentId ?? TOP_LEVEL);
  const summary = moveSummary(row);
  return (
    <p>
      <label>
        Move {row.node.name} under{" "}
        <select
          value={target}
          onChange={(event) => setTarget(event.target.value)}
        >
          <option value={TOP_LEVEL}>Top level</option>
          {nodes.map((other) => (
            <option key={other.node.id} value={other.node.id}>
              {[...other.path, other.node.name].join(" › ")}
            </option>
          ))}
        </select>
      </label>
      {summary && <span> {summary}</span>}{" "}
      <button
        type="button"
        disabled={busy}
        onClick={() => onMove(target === TOP_LEVEL ? undefined : target)}
      >
        Move
      </button>{" "}
      <button type="button" onClick={onCancel}>
        Cancel
      </button>
    </p>
  );
}
