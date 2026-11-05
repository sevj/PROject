"use client";

import type { Plan, PlanNode } from "@/lib/explain";
import { useMessages } from "@/i18n/provider";
import { BADGE_ALERT, CARD, DATA, SECTION_TITLE } from "../ui";

const count = (value: number) => Math.round(value).toLocaleString("en-US");
const cost = (value: number) => value.toLocaleString("en-US", { maximumFractionDigits: 2 });
const duration = (ms: number) => (ms < 1000 ? `${ms < 10 ? ms.toFixed(2) : Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`);

/** A step that takes this much of the whole by itself stands out. */
const HOT_SHARE = 0.3;

function Node({ node, analyzed }: { node: PlanNode; analyzed: boolean }) {
  const m = useMessages().databases;
  const hot = node.share !== null && node.share >= HOT_SHARE;
  return (
    <li className="grid gap-1">
      <div className={`grid gap-1 border-l-2 py-1 pl-3 ${hot ? "border-alert bg-alert/10" : "border-rule-strong"}`}>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
          <span className="font-bold">{node.label}</span>
          {node.rows !== null ? <span className={`${DATA} text-mut`}>{m.planRows(count(node.rows))}</span> : null}
          {node.actualRows !== null ? <span className={`${DATA} text-mut`}>{m.planActual(count(node.actualRows))}</span> : null}
          {node.cost !== null ? <span className={`${DATA} text-mut`}>{m.planCost(cost(node.cost))}</span> : null}
          {analyzed && node.timeMs !== null ? <span className={`${DATA} text-mut`}>{m.planTime(duration(node.timeMs))}</span> : null}
        </div>
        {node.details.map((line, index) => (
          <span key={index} className={`${DATA} break-all text-mut`}>
            {line}
          </span>
        ))}
        {node.share !== null ? (
          <div className="flex items-center gap-2" title={m.planShare(Math.round(node.share * 100))}>
            <div className="h-1.5 w-40 bg-sel">
              <div className={`h-full ${hot ? "bg-alert" : "bg-accent"}`} style={{ width: `${Math.max(2, Math.round(node.share * 100))}%` }} />
            </div>
            <span className="text-[11px] text-mut">{Math.round(node.share * 100)}%</span>
          </div>
        ) : null}
        {node.warnings.map((warning) => (
          <p key={warning} className="flex items-start gap-2 text-[12px]">
            <span className={BADGE_ALERT}>!</span>
            <span>{m.planWarnings[warning]}</span>
          </p>
        ))}
      </div>
      {node.children.length > 0 ? (
        <ul className="ml-4 grid gap-1">
          {node.children.map((child, index) => (
            <Node key={index} node={child} analyzed={analyzed} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function PlanView({ plan, elapsedMs }: { plan: Plan; elapsedMs: number }) {
  const m = useMessages().databases;
  return (
    <div className={`${CARD} grid gap-2`}>
      <h3 className={SECTION_TITLE}>{m.planTitle}</h3>
      <p className="text-[12px] text-mut">
        {plan.analyzed ? m.planMeasured(plan.planningMs !== null ? duration(plan.planningMs) : "–", plan.executionMs !== null ? duration(plan.executionMs) : "–") : m.planEstimated}{" "}
        {m.elapsed(elapsedMs)}
      </p>
      <ul className="grid gap-1 overflow-x-auto">
        <Node node={plan.root} analyzed={plan.analyzed} />
      </ul>
    </div>
  );
}
