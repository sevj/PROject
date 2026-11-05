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

export const expandHome = (path: string, home: string) => (path.startsWith("~/") ? `${home}${path.slice(1)}` : path);

/** How to reach the machine: what a test and a console have in common. */
function sshConnection(target: SshTarget, home: string): string[] {
  const args: string[] = [];
  if (target.auth === "password") args.push("-o", "PubkeyAuthentication=no", "-o", "PreferredAuthentications=password,keyboard-interactive");
  if (target.auth === "key" && target.keyPath) args.push("-i", expandHome(target.keyPath, home), "-o", "IdentitiesOnly=yes");
  if (target.auth !== "alias") {
    if (target.port !== null) args.push("-p", String(target.port));
    if (target.username) args.push("-l", target.username);
    if (target.jumpHost) args.push("-J", target.jumpHost);
  }
  return args;
}

/**
 * The arguments of `ssh`, which never asks anything. Host keys follow the user's own settings:
 * unknown ones are refused rather than accepted on their behalf, and nothing is written to known_hosts.
 */
export function sshArguments(target: SshTarget, remoteCommand: string, home: string): string[] {
  const asks = target.auth === "password" ? ["-o", "NumberOfPasswordPrompts=1"] : ["-o", "BatchMode=yes"];
  return ["-o", "ConnectTimeout=8", "-o", "ServerAliveInterval=5", "-o", "ServerAliveCountMax=1", ...asks, ...sshConnection(target, home), "--", target.host, remoteCommand];
}

/**
 * For a person at a terminal: ssh may ask for a password or about a host key, and they answer.
 * A kept password gets one try, since sshpass cannot answer a second prompt.
 */
export function sshConsoleArguments(target: SshTarget, path: string | null, keptPassword: boolean, home: string): string[] {
  // A folder that has moved must not cost the session: `cd` says so, and the shell opens anyway.
  const start = path ? [`cd ${sq(path)}; exec "\${SHELL:-/bin/sh}" -l`] : [];
  return ["-tt", "-o", "ConnectTimeout=15", "-o", "ServerAliveInterval=30", ...(keptPassword ? ["-o", "NumberOfPasswordPrompts=1"] : []), ...sshConnection(target, home), "--", target.host, ...start];
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
  | "noRunningPod"
  | "ambiguousTarget"
  | "containerMissing"
  | "timeout"
  | "vpnDown"
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
  if (/notfound|not found/i.test(stderr)) return "targetMissing";
  if (/unable to connect|timeout|no such host|connection refused/i.test(stderr)) return "unreachable";
  return "unknown";
}

const KUBE_TIMEOUT = "--request-timeout=10s";

/** `--name=value`, so that a value can never be read as another option. */
export const kubeClusterArguments = (context: string) => [`--context=${context}`, KUBE_TIMEOUT, "version", "-o", "json"];

const scope = (context: string, namespace: string | null) => [`--context=${context}`, ...(namespace ? [`--namespace=${namespace}`] : []), KUBE_TIMEOUT];

export const isWorkload = (target: string) => WORKLOAD.test(target);

export const kubeWorkloadArguments = (context: string, namespace: string | null, workload: string) => [...scope(context, namespace), "get", workload, "-o", "json"];

export const kubePodsArguments = (context: string, namespace: string | null, selector: string | null) => [
  ...scope(context, namespace),
  "get",
  "pods",
  ...(selector ? [`--selector=${selector}`] : []),
  "--field-selector=status.phase=Running",
  "-o",
  "json",
];

/** What the workload asks for. It only narrows the search: see `choosePod` for what decides. */
export function workloadSelector(json: string): string | null {
  const labels = (JSON.parse(json) as { spec?: { selector?: { matchLabels?: Record<string, string> } } }).spec?.selector?.matchLabels ?? {};
  return Object.entries(labels).map(([key, value]) => `${key}=${value}`).join(",") || null;
}

export type RunningPod = {
  name: string;
  /** The workload it belongs to, such as `deployment/api`. Null for a pod on its own. */
  owner: string | null;
  ready: boolean;
  terminating: boolean;
  containers: string[];
};

type RawPod = {
  metadata?: { name?: string; deletionTimestamp?: string; labels?: Record<string, string>; ownerReferences?: { kind?: string; name?: string; controller?: boolean }[] };
  spec?: { containers?: { name?: string }[] };
  status?: { containerStatuses?: { ready?: boolean }[] };
};

/** A ReplicaSet of a Deployment is named after it, followed by the hash its pods carry. */
function ownerOf({ metadata }: RawPod): string | null {
  const owner = metadata?.ownerReferences?.find(({ controller }) => controller) ?? metadata?.ownerReferences?.[0];
  if (!owner?.name) return null;
  if (owner.kind === "ReplicaSet") {
    const hash = metadata?.labels?.["pod-template-hash"];
    const suffix = `-${hash}`;
    return hash && owner.name.endsWith(suffix) ? `deployment/${owner.name.slice(0, -suffix.length)}` : `replicaset/${owner.name}`;
  }
  return `${owner.kind?.toLowerCase()}/${owner.name}`;
}

export function parsePods(json: string): RunningPod[] {
  const { items = [] } = JSON.parse(json) as { items?: RawPod[] };
  return items.map((pod) => {
    const statuses = pod.status?.containerStatuses ?? [];
    return {
      name: pod.metadata?.name ?? "",
      owner: ownerOf(pod),
      ready: statuses.length > 0 && statuses.every(({ ready }) => ready === true),
      terminating: Boolean(pod.metadata?.deletionTimestamp),
      containers: (pod.spec?.containers ?? []).flatMap(({ name }) => name ?? []),
    };
  });
}

/**
 * `kubectl exec deployment/x` takes any pod its selector matches, and a selector can be wider than
 * its workload: a chart may give a database the same labels. So a workload is entered only through a
 * pod it owns, and labels that span several workloads are refused rather than picked at random.
 * During a deployment, a pod that is ready and not on its way out comes first.
 */
export function choosePod(pods: RunningPod[], target: string): { pod: RunningPod } | { failure: "noRunningPod" } | { failure: "ambiguousTarget"; detail: string } {
  const alive = pods.filter(({ terminating, name }) => !terminating && isPodName(name));
  const candidates = isWorkload(target) ? alive.filter(({ owner }) => owner === target) : alive;
  if (candidates.length === 0) return { failure: "noRunningPod" };
  const owners = new Set(candidates.map(({ owner, name }) => owner ?? name));
  if (owners.size > 1) return { failure: "ambiguousTarget", detail: [...owners].sort().join(", ") };
  const [pod] = [...candidates].sort((a, b) => Number(b.ready) - Number(a.ready) || a.name.localeCompare(b.name));
  return { pod };
}

const POD_NAME = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/;

export const isPodName = (value: string) => POD_NAME.test(value);

/** bash when the image has it. Always a pod chosen beforehand: see `choosePod`. */
export function kubeExecArguments(context: string, namespace: string | null, pod: string, container: string | null): string[] {
  return [
    `--context=${context}`,
    ...(namespace ? [`--namespace=${namespace}`] : []),
    "exec",
    "-it",
    `pod/${pod}`,
    ...(container ? [`--container=${container}`] : []),
    "--",
    "sh",
    "-c",
    "command -v bash >/dev/null 2>&1 && exec bash; exec sh",
  ];
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
