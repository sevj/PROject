"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useRef, useState } from "react";
import { useMessages } from "@/i18n/provider";
import type { PlanItem } from "@/server/config-share";
import { DirectoryInput } from "./directory-input";
import { useFlash } from "./flash";
import { Modal } from "./modal";
import { PlanList } from "./projects/[id]/config-share";
import { BUTTON, BUTTON_PRIMARY, DATA, LABEL } from "./ui";

type Answer = { project: string; projectId: number | null; items: PlanItem[] } | { problem: string; detail?: string };

async function ask(config: unknown, directory: string, apply: boolean): Promise<Answer | null> {
  try {
    const response = await fetch("/api/projects/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ config, directory, apply }) });
    return response.ok ? ((await response.json()) as Answer) : null;
  } catch {
    return null;
  }
}

/** A project shared by a colleague: its file, then the folder where it was cloned here. */
export function ImportProjectButton({ className }: { className: string }) {
  const messages = useMessages();
  const m = messages.environments.share;
  const flash = useFlash();
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<{ config: unknown; name: string; folder: string } | null>(null);
  const [directory, setDirectory] = useState("");
  const [plan, setPlan] = useState<PlanItem[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const close = () => {
    setFile(null);
    setPlan(null);
    setProblem(null);
    if (input.current) input.current.value = "";
  };

  const open = async (chosen: File) => {
    try {
      const config = JSON.parse(await chosen.text()) as { sheet?: { name?: unknown; folder?: unknown } };
      const name = typeof config.sheet?.name === "string" ? config.sheet.name : "";
      if (!name) {
        flash("error", m.noSheet);
        return;
      }
      setFile({ config, name, folder: typeof config.sheet?.folder === "string" ? config.sheet.folder : "" });
    } catch {
      flash("error", m.unreadable);
    }
  };

  const preview = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const chosen = String(new FormData(event.currentTarget).get("directory") ?? "");
    setDirectory(chosen);
    setPending(true);
    const answer = await ask(file?.config, chosen, false);
    setPending(false);
    if (!answer) setProblem(m.unreadable);
    else if ("problem" in answer) setProblem(answer.problem === "directory" ? (answer.detail ?? m.unreadable) : answer.problem === "noSheet" ? m.noSheet : m.invalidFile);
    else {
      setProblem(null);
      setPlan(answer.items);
    }
  };

  const apply = async () => {
    setPending(true);
    const answer = await ask(file?.config, directory, true);
    setPending(false);
    if (!answer || "problem" in answer || answer.projectId === null) {
      setProblem(answer && "problem" in answer && answer.detail ? answer.detail : m.invalidFile);
      return;
    }
    flash("success", m.projectImported(answer.project));
    close();
    router.push(`/projects/${answer.projectId}`);
  };

  return (
    <>
      <button type="button" onClick={() => input.current?.click()} title={m.importProjectHint} className={className}>
        {m.importProject}
      </button>
      <input
        ref={input}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(event) => {
          const chosen = event.target.files?.[0];
          if (chosen) void open(chosen);
        }}
      />
      {file ? (
        <Modal title={m.importProjectTitle(file.name)} wide onClose={close}>
          <p className="text-mut">{m.importProjectIntro}</p>
          <form onSubmit={(event) => void preview(event)} className="grid gap-2">
            <label htmlFor="import-directory" className={LABEL}>
              {m.directory}
            </label>
            <DirectoryInput id="import-directory" name="directory" defaultValue={file.folder ? `~/Projects/${file.folder}` : "~/Projects/"} autoFocus />
            <div>
              <button type="submit" disabled={pending} className={BUTTON}>
                {m.preview}
              </button>
            </div>
          </form>
          {problem ? <p role="alert" className={`${DATA} text-alert`}>{problem}</p> : null}
          {plan ? <PlanList items={plan} /> : null}
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={pending || !plan} onClick={() => void apply()} className={BUTTON_PRIMARY}>
              {m.importProjectAction}
            </button>
            <button type="button" onClick={close} className={BUTTON}>
              {messages.common.cancel}
            </button>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
