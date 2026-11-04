"use client";

import "@xyflow/react/dist/style.css";
import { Background, Controls, type Edge, Handle, MarkerType, type Node, type NodeProps, Position, ReactFlow } from "@xyflow/react";
import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { useMessages } from "@/i18n/provider";
import { ENGINE_LABELS } from "@/lib/db-engines";
import type { MapLayout, MapNode, MapState } from "@/lib/project-map";

/** Green is running, grey is stopped, an empty ring is not created: the state is also written in the node's title. */
export const STATE_COLORS: Record<MapState, string> = {
  running: "var(--ok)",
  stopped: "var(--mut)",
  absent: "transparent",
  other: "var(--alert)",
};

type Data = { node: MapNode };

function ProjectNodeView({ data }: NodeProps<Node<Data>>) {
  const m = useMessages().map;
  const router = useRouter();
  return (
    <button
      type="button"
      title={m.open(data.node.label)}
      onClick={() => router.push(`/projects/${data.node.projectId}?tab=docker`)}
      className="w-[220px] cursor-pointer border border-accent bg-accent px-3 py-2.5 text-left font-sans text-[14px] font-semibold text-bg"
    >
      <span className="block truncate">{data.node.label}</span>
      <Handle type="source" position={Position.Right} className="!size-1.5 !border-0 !bg-accent" />
    </button>
  );
}

function ServiceNodeView({ data }: NodeProps<Node<Data>>) {
  const m = useMessages().map;
  const { node } = data;
  const state = node.state ?? "absent";
  return (
    <div
      title={`${node.label} · ${m.states[state]}${node.image ? ` · ${node.image}` : ""}`}
      className="w-[220px] border border-rule-strong bg-bg px-3 py-2 font-sans text-[13px] text-ink"
    >
      <Handle type="target" position={Position.Left} className="!size-1.5 !border-0 !bg-mut" />
      <div className="flex items-center gap-2">
        <span
          className="inline-block size-2.5 shrink-0 rounded-full border border-mut"
          style={{ background: STATE_COLORS[state], borderColor: state === "running" ? "transparent" : undefined }}
          aria-hidden="true"
        />
        <span className="truncate font-semibold">{node.label}</span>
        {node.engine ? (
          <span className="ml-auto shrink-0 bg-sel px-1.5 font-mono text-[10px] text-mut" title={m.database}>
            {ENGINE_LABELS[node.engine]}
          </span>
        ) : null}
      </div>
      {node.image ? <p className="truncate font-mono text-[11px] text-mut">{node.image}</p> : null}
      {node.ports.length > 0 ? <p className="truncate font-mono text-[11px] text-mut">{node.ports.slice(0, 3).join(" · ")}</p> : null}
      <Handle type="source" position={Position.Right} className="!size-1.5 !border-0 !bg-mut" />
    </div>
  );
}

const NODE_TYPES = { project: ProjectNodeView, service: ServiceNodeView };

export function MapCanvas({ layout }: { layout: MapLayout }) {
  const nodes = useMemo<Node<Data>[]>(
    () => layout.nodes.map((node) => ({ id: node.id, type: node.kind, position: { x: node.x, y: node.y }, data: { node }, draggable: true })),
    [layout.nodes],
  );
  const edges = useMemo<Edge[]>(
    () =>
      layout.edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        type: "smoothstep",
        style: edge.kind === "contains" ? { stroke: "var(--mut)", strokeWidth: 1, strokeDasharray: "4 4" } : { stroke: "var(--accent)", strokeWidth: 1.5 },
        markerEnd: edge.kind === "depends" ? { type: MarkerType.ArrowClosed, color: "var(--accent)" } : undefined,
      })),
    [layout.edges],
  );
  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={NODE_TYPES}
      colorMode="system"
      fitView
      fitViewOptions={{ padding: 0.15, maxZoom: 1 }}
      minZoom={0.1}
      nodesConnectable={false}
      proOptions={{ hideAttribution: true }}
    >
      <Background gap={24} />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}
