"use client";

import "@xyflow/react/dist/style.css";
import { Background, Controls, type Edge, Handle, MarkerType, type Node, type NodeProps, Position, ReactFlow } from "@xyflow/react";
import { useMessages } from "@/i18n/provider";
import { type RelationLayout, type RelationNode, tableLabel, type TableKey } from "@/lib/db-schema";

type Data = { node: RelationNode };

const GLYPH = { key: "→", self: "↻", target: "★" } as const;

function TableNodeView({ data }: NodeProps<Node<Data>>) {
  const m = useMessages().databases.relations;
  const { node } = data;
  const label = tableLabel(node.table);
  return (
    <div title={m.open(label)} className="w-[240px] cursor-pointer border border-rule-strong bg-bg font-sans text-[13px] text-ink hover:border-accent">
      <Handle type="target" position={Position.Left} className="!size-1.5 !border-0 !bg-accent" />
      <p className="truncate border-b border-rule px-2.5 py-1.5 font-semibold">{label}</p>
      <ul className="px-2.5 py-1">
        {node.columns.map(({ name, role }) => (
          <li key={name} title={m.roles[role]} className="flex items-baseline gap-1.5 font-mono text-[11px] leading-[18px] text-mut">
            <span aria-hidden="true" className={role === "target" ? "" : "text-accent"}>
              {GLYPH[role]}
            </span>
            <span className="truncate">{name}</span>
          </li>
        ))}
      </ul>
      <Handle type="source" position={Position.Right} className="!size-1.5 !border-0 !bg-accent" />
    </div>
  );
}

const NODE_TYPES = { table: TableNodeView };

/** Remounted with a `key` for another set of tables: until then, what was moved stays where it was put. */
export function RelationsCanvas({
  layout,
  showLabels,
  onOpen,
}: {
  layout: RelationLayout;
  showLabels: boolean;
  onOpen: (table: TableKey) => void;
}) {
  const nodes: Node<Data>[] = layout.nodes.map((node) => ({
    id: node.id,
    type: "table",
    position: { x: node.x, y: node.y },
    data: { node },
  }));
  const edges: Edge[] = layout.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    type: "smoothstep",
    label: showLabels ? edge.label : undefined,
    labelStyle: { fill: "var(--ink)", fontFamily: "var(--font-dm-mono), monospace", fontSize: 11 },
    labelBgStyle: { fill: "var(--bg)" },
    style: { stroke: "var(--accent)", strokeWidth: 1.25 },
    markerEnd: { type: MarkerType.ArrowClosed, color: "var(--accent)" },
  }));
  return (
    <ReactFlow
      defaultNodes={nodes}
      defaultEdges={edges}
      nodeTypes={NODE_TYPES}
      onNodeClick={(_event, node) => onOpen((node.data as Data).node.table)}
      colorMode="system"
      fitView
      fitViewOptions={{ padding: 0.1, maxZoom: 1 }}
      minZoom={0.05}
      nodesConnectable={false}
      proOptions={{ hideAttribution: true }}
    >
      <Background gap={24} />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}
