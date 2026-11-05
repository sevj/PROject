/** What can be declared about remote servers, and how the commands that reach them are built. No I/O here. */

export type SshAuth = "alias" | "agent" | "key" | "password";

export type SshTarget = {
  host: string;
  port: number | null;
  username: string | null;
  auth: SshAuth;
  keyPath: string | null;
  jumpHost: string | null;
};

// Each of these ends up on a command line: nothing here may look like an option or hold a shell character.
const HOST = /^[A-Za-z0-9_][A-Za-z0-9._:-]*$/;
const USER = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/;
const JUMP = /^([A-Za-z0-9_][A-Za-z0-9._-]*@)?[A-Za-z0-9_][A-Za-z0-9._:-]*$/;
const KEY_PATH = /^(~\/|\/)[^\0\n]+$/;
const DNS_NAME = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/;
const WORKLOAD = /^(deployment|statefulset|daemonset)\/[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/;
const LABELS = /^[A-Za-z0-9][A-Za-z0-9./_-]*=[A-Za-z0-9._-]*(,[A-Za-z0-9][A-Za-z0-9./_-]*=[A-Za-z0-9._-]*)*$/;

export const isHost = (value: string) => HOST.test(value);
export const isUsername = (value: string) => USER.test(value);
export const isJumpHost = (value: string) => JUMP.test(value);
export const isKeyPath = (value: string) => KEY_PATH.test(value);
export const isPort = (value: number) => Number.isInteger(value) && value >= 1 && value <= 65535;
export const isNamespace = (value: string) => DNS_NAME.test(value) && !value.includes(".");
export const isContainerName = (value: string) => DNS_NAME.test(value) && !value.includes(".");
export const isKubeTarget = (value: string) => WORKLOAD.test(value) || LABELS.test(value);
/** Absolute: `~` is not expanded once quoted, and a relative folder depends on the account. */
export const isKubeContext = (value: string) => /^[^\s\0]+$/.test(value);
export const isRemotePath = (value: string) => /^\/[^\0\n]*$/.test(value);

/** Only what a browser can safely open: a link holding `javascript:` would run in the app. */
export function isWebUrl(value: string): boolean {
  try {
    const { protocol, hostname } = new URL(value);
    return (protocol === "http:" || protocol === "https:") && hostname !== "";
  } catch {
    return false;
  }
}

/** Without accents, so that "préproduction" is not taken for "production". */
export function looksLikeProduction(name: string): boolean {
  const plain = name.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
  return /(^|[\s_])prod(uction)?($|[\s_-])/.test(plain);
}

const sq = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;

const expandHome = (path: string, home: string) => (path.startsWith("~/") ? `${home}${path.slice(1)}` : path);

/**
 * The arguments of `ssh`. Host keys follow the user's own settings: unknown ones are refused
 * rather than accepted on their behalf, and nothing is written to known_hosts.
 */
export function sshArguments(target: SshTarget, remoteCommand: string, home: string): string[] {
  const args = ["-o", "ConnectTimeout=8", "-o", "ServerAliveInterval=5", "-o", "ServerAliveCountMax=1"];
  if (target.auth === "password") {
    args.push("-o", "PubkeyAuthentication=no", "-o", "PreferredAuthentications=password,keyboard-interactive", "-o", "NumberOfPasswordPrompts=1");
  } else {
    args.push("-o", "BatchMode=yes");
  }
  if (target.auth === "key" && target.keyPath) args.push("-i", expandHome(target.keyPath, home), "-o", "IdentitiesOnly=yes");
  if (target.auth !== "alias") {
    if (target.port !== null) args.push("-p", String(target.port));
    if (target.username) args.push("-l", target.username);
    if (target.jumpHost) args.push("-J", target.jumpHost);
  }
  args.push("--", target.host, remoteCommand);
  return args;
}

/** Nothing but a look: `true`, or whether the folder of the project is there. */
export const sshProbe = (path: string | null) => (path ? `test -d ${sq(path)}` : "true");

export type TestFailure =
  | "wrongPassword"
  | "unknownHostKey"
  | "refused"
  | "unreachable"
  | "folderMissing"
  | "passwordNeeded"
  | "sshMissing"
  | "sshpassMissing"
  | "kubectlMissing"
  | "contextMissing"
  | "targetMissing"
  | "containerMissing"
  | "timeout"
  | "gone"
  | "unknown";

export type TestResult = { ok: true } | { ok: false; failure: TestFailure; detail: string };

/** `viaSshpass`: it has exit codes of its own, and ssh keeps 255 for itself. */
export function readSshExit(code: number | null, stderr: string, viaSshpass: boolean, probedFolder: boolean): TestFailure | null {
  if (code === 0) return null;
  if (code === null) return "timeout";
  if (viaSshpass && code === 5) return "wrongPassword";
  if (viaSshpass && code === 6) return "unknownHostKey";
  if (code === 1 && probedFolder) return "folderMissing";
  if (/host key verification failed|no .* host key is known/i.test(stderr)) return "unknownHostKey";
  if (/permission denied|too many authentication failures/i.test(stderr)) return viaSshpass ? "wrongPassword" : "refused";
  if (/could not resolve|connection refused|timed out|no route to host|network is unreachable|connection closed|kex_exchange/i.test(stderr)) return "unreachable";
  return "unknown";
}

export function readKubeExit(code: number | null, stderr: string): TestFailure | null {
  if (code === 0) return null;
  if (code === null) return "timeout";
  if (/context .*(does not exist|was not found)/i.test(stderr)) return "contextMissing";
  if (/forbidden|unauthorized|must be logged in/i.test(stderr)) return "refused";
  if (/notfound|not found|array index out of bounds/i.test(stderr)) return "targetMissing";
  if (/unable to connect|timeout|no such host|connection refused/i.test(stderr)) return "unreachable";
  return "unknown";
}

const KUBE_TIMEOUT = "--request-timeout=10s";

/** `--name=value`, so that a value can never be read as another option. */
export const kubeClusterArguments = (context: string) => [`--context=${context}`, KUBE_TIMEOUT, "version", "-o", "json"];

/** Reads the names of the containers of the target, which also says whether it exists. */
export function kubeTargetArguments(context: string, namespace: string | null, target: string): string[] {
  const scope = [`--context=${context}`, ...(namespace ? [`--namespace=${namespace}`] : []), KUBE_TIMEOUT];
  return WORKLOAD.test(target)
    ? [...scope, "get", target, "-o", "jsonpath={.spec.template.spec.containers[*].name}"]
    : [...scope, "get", "pods", `--selector=${target}`, "-o", "jsonpath={.items[0].spec.containers[*].name}"];
}

/** The `Host` lines of an SSH config: patterns such as `*` name no machine. */
export function parseSshAliases(config: string): string[] {
  const aliases = config
    .split("\n")
    .map((line) => /^\s*host\s+(.+)$/i.exec(line)?.[1] ?? "")
    .flatMap((names) => names.trim().split(/\s+/))
    .filter((name) => name !== "" && !/[*?!]/.test(name) && isHost(name));
  return [...new Set(aliases)].sort();
}

/** A private key is recognized by its public half, without opening it. */
export function privateKeysAmong(files: string[]): string[] {
  const names = new Set(files);
  return files.filter((file) => file.endsWith(".pub") && names.has(file.slice(0, -4))).map((file) => file.slice(0, -4)).sort();
}
