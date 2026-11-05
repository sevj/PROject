"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { useFlash } from "@/app/flash";
import { Modal } from "@/app/modal";
import { BADGE, BADGE_ALERT, BUTTON, BUTTON_PRIMARY, BUTTON_SMALL, DATA } from "@/app/ui";
import { useMessages } from "@/i18n/provider";
import type { PlanItem } from "@/server/config-share";

type Plan = { project: string; items: PlanItem[] };

const ACTION_CLASS: Record<PlanItem["action"], string> = { create: "bg-ok/15 text-ok", keep: BADGE, skip: BADGE_ALERT };

async function ask(projectId: number, config: unknown, apply: boolean): Promise<Plan | { problem: string } | null> {
  try {
    const response = await fetch(`/api/projects/${projectId}/config`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ config, apply }) });
    return response.ok ? ((await response.json()) as Plan | { problem: string }) : null;
  } catch {
    return null;
  }
}

/** Export as a file, import from one with a look at what it would do first. */
export function ConfigShare({ projectId, readOnly }: { projectId: number; readOnly: boolean }) {
  const messages = useMessages();
  const m = messages.environments.share;
  const flash = useFlash();
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [config, setConfig] = useState<unknown>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [pending, setPending] = useState(false);

  const open = async (file: File) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      flash("error", m.unreadable);
      return;
    }
    const answer = await ask(projectId, parsed, false);
    if (!answer || "problem" in answer) {
      flash("error", answer ? m.invalidFile : m.unreadable);
      return;
    }
    setConfig(parsed);
    setPlan(answer);
  };

  const close = () => {
    setPlan(null);
    setConfig(null);
    if (input.current) input.current.value = "";
  };

  const apply = async () => {
    setPending(true);
    const answer = await ask(projectId, config, true);
    setPending(false);
    if (!answer || "problem" in answer) {
      flash("error", m.invalidFile);
      return;
    }
    flash("success", m.done(answer.items.filter(({ action }) => action === "create").length));
    close();
    router.refresh();
  };

  const creating = plan?.items.filter(({ action }) => action === "create").length ?? 0;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <a href={`/api/projects/${projectId}/config`} download title={m.exportHint} className={BUTTON_SMALL}>
        {m.export}
      </a>
      {readOnly ? null : (
        <>
          <button type="button" onClick={() => input.current?.click()} className={BUTTON_SMALL}>
            {m.import}
          </button>
          <input
            ref={input}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void open(file);
            }}
          />
        </>
      )}
      {plan ? (
        <Modal title={m.title(plan.project)} wide onClose={close}>
          <p className="text-mut">{m.intro}</p>
          <ul className="grid max-h-[55vh] gap-1 overflow-y-auto">
            {plan.items.map((item, index) => (
              <li key={index} className="flex flex-wrap items-center gap-2 border-b border-rule py-1.5 last:border-b-0">
                <span className={`${DATA} w-32 shrink-0 text-mut`}>{m.kinds[item.kind]}</span>
                <span className="min-w-0 flex-1 break-all">{item.name}</span>
                <span className={`${DATA} px-1.5 ${ACTION_CLASS[item.action]}`}>{m.actions[item.action]}</span>
                {item.reason && item.reason !== "exists" ? <span className="basis-full pl-[136px] text-[12px] text-mut">{m.reasons[item.reason]}</span> : null}
              </li>
            ))}
          </ul>
          {creating === 0 ? <p className="text-mut">{m.nothing}</p> : null}
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={pending || creating === 0} onClick={() => void apply()} className={BUTTON_PRIMARY}>
              {m.apply(creating)}
            </button>
            <button type="button" onClick={close} className={BUTTON}>
              {messages.common.cancel}
            </button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
