export const DEFAULT_IDE_COMMANDS: Record<string, string> = {
  PHP: "phpstorm {path}",
  default: "code {path}",
};

const IDE_LABELS: Record<string, string> = {
  phpstorm: "PhpStorm",
  code: "VS Code",
  webstorm: "WebStorm",
  idea: "IntelliJ",
  goland: "GoLand",
  rustrover: "RustRover",
  pycharm: "PyCharm",
  zed: "Zed",
};

/** The first stack with its own command wins, so that PHP + Node opens the PHP IDE. */
export function ideCommandFor(stacks: string[], commands: Record<string, string>): string {
  const stack = stacks.find((name) => commands[name]);
  return stack ? commands[stack] : (commands.default ?? DEFAULT_IDE_COMMANDS.default);
}

/** No shell is involved, so a path with spaces or quotes stays a single argument. */
export function buildCommand(template: string, path: string): { file: string; args: string[] } | null {
  const tokens = template.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;
  const hasPlaceholder = tokens.some((token) => token.includes("{path}"));
  const filled = tokens.map((token) => token.replaceAll("{path}", path));
  const [file, ...args] = hasPlaceholder ? filled : [...filled, path];
  return { file, args };
}

export function ideLabel(template: string): string {
  const command = template.trim().split(/\s+/)[0] ?? "";
  const name = command.split("/").at(-1) ?? command;
  return IDE_LABELS[name] ?? name;
}
