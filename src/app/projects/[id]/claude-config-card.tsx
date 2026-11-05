import type { Messages } from "@/i18n";
import type { ClaudeTask } from "@/lib/claude-console";
import type { ClaudeConfig } from "@/server/claude-config";
import { ClaudeConsoleButton } from "../../claude-console-button";
import { CARD, DATA, SECTION_TITLE } from "../../ui";

function Names({ label, names }: { label: string; names: string[] }) {
  return names.length === 0 ? null : (
    <div className="flex justify-between gap-4 border-b border-rule py-1.5 last:border-b-0">
      <dt className="shrink-0 text-mut">{label}</dt>
      <dd className={`${DATA} min-w-0 text-right break-words`}>{names.join(", ")}</dd>
    </div>
  );
}

export function ClaudeConfigCard({
  config,
  projectId,
  projectName,
  canOpen,
  m,
}: {
  config: ClaudeConfig;
  projectId: number;
  projectName: string;
  canOpen: boolean;
  m: Messages["sheet"]["claudeConfig"];
}) {
  const task: ClaudeTask = config.state === "none" ? "generate" : "review";
  const hasSetup =
    config.mcpServers.length + config.hooks.length + config.skills.length + config.agents.length + config.commands.length + config.rules.length + config.memories > 0;
  return (
    <section className={`${CARD} my-4`}>
      <div className={`${SECTION_TITLE} mb-3`}>
        <h2>{m.title}</h2>
      </div>
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <p className={`min-w-0 flex-[1_1_320px] ${config.state === "shadowed" ? "text-alert" : ""}`}>{m.states[config.state]}</p>
        {canOpen ? <ClaudeConsoleButton projectId={projectId} projectName={projectName} task={task} /> : null}
      </div>
      <p className="pt-1 text-[12px] text-mut">{m.tasks[task]}</p>

      {config.instructions.map(({ name, lines, content, generatedByNext }) => (
        <details key={name} className="mt-3 border border-rule">
          <summary className={`${DATA} cursor-pointer px-2.5 py-1.5 hover:bg-sel`}>
            {name} · {m.lines(lines)}
            {generatedByNext ? ` · ${m.fromNext}` : ""}
          </summary>
          <pre className={`${DATA} max-h-[420px] overflow-auto border-t border-rule bg-field p-2.5 break-words whitespace-pre-wrap`}>{content}</pre>
        </details>
      ))}

      {hasSetup ? (
        <dl className="mt-3">
          <Names label={m.mcpServers} names={config.mcpServers} />
          <Names label={m.hooks} names={config.hooks} />
          <Names label={m.skills} names={config.skills} />
          <Names label={m.agents} names={config.agents} />
          <Names label={m.commands} names={config.commands} />
          <Names label={m.rules} names={config.rules} />
          <Names label={m.memories} names={config.memories > 0 ? [String(config.memories)] : []} />
        </dl>
      ) : null}
    </section>
  );
}
