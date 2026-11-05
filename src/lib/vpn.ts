/** What can be declared about a VPN, and how the commands that drive it are built. No I/O here. */

export const isOvpnPath = (value: string) => /^(~\/|\/)[^\0\n]+\.ovpn$/i.test(value);
/** It goes in a `key=value` list of nmcli, which gives these characters a meaning. */
export const isVpnUsername = (value: string) => /^[^\s,=\\'"]+$/.test(value);
export const isGateway = (value: string) => /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value);
export const isOrganization = isGateway;
/** Without an organization, `nordlayer login` asks which one, in its terminal. */
export const nordLoginArguments = (organization: string | null) => ["login", ...(organization ? ["--organization", organization] : [])];
export const isOneLine = (value: string) => !/[\r\n\0]/.test(value);

/**
 * NetworkManager refuses `route remote_host …`, which only keeps the way to the VPN server outside
 * the tunnel. It already does that by itself, so the line goes. Its place stays, so that a
 * refusal of another line still names the right line of the user's file.
 */
export const ovpnForImport = (content: string) => content.replace(/^[ \t]*route[ \t]+remote_host\b.*$/gim, "# removed: NetworkManager keeps the way to the server by itself");

export const nmImportArguments = (file: string) => ["connection", "import", "type", "openvpn", "file", file];

const IMPORTED = /\(([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)/i;
export const parseImportedUuid = (stdout: string) => IMPORTED.exec(stdout)?.[1] ?? null;

/** Flag 2 means the password is not saved by NetworkManager: this app gives it at each connection. */
export function nmSetupArguments(uuid: string, name: string, username: string | null): string[] {
  const data = [...(username ? [`username=${username}`] : []), "password-flags=2"];
  return ["connection", "modify", uuid, "connection.id", name, "connection.autoconnect", "no", ...data.flatMap((item) => ["+vpn.data", item])];
}

export const nmUpArguments = (uuid: string, waitSeconds: number) => ["--wait", String(waitSeconds), "connection", "up", uuid];

/**
 * For `sh`: the editor of nmcli reads what the pipe of `runCommand` holds, so nothing shows on a
 * command line, where `nmcli connection modify` would need it.
 */
export const nmEditArguments = (uuid: string) => ["-c", 'cat <&3 | exec nmcli connection edit "$1"', "sh", uuid];

/**
 * As read on a real connection: the editor takes `\\\\`, `\\,` and `\\ ` as escapes, and cuts at a bare
 * comma. Written this way, what the server receives is the password, whatever follows a backslash.
 */
const escapeForEditor = (password: string) => password.replace(/[\\,]/g, (char) => `\\${char}`);

/**
 * A password NetworkManager does not hold is asked of whoever listens first, which on a desktop is
 * a window of its own. Held for the time of the connection, it asks nobody, and `temporary` never
 * reaches the disk. A token changes each time anyway, so nothing here is worth keeping.
 */
export const nmHoldSecretScript = (password: string) =>
  ["set vpn.data password-flags = 0", `set vpn.secrets password = ${escapeForEditor(password)}`, "save temporary", "quit"].join("\n");
export const NM_RELEASE_SECRET_SCRIPT = ["remove vpn.secrets", "set vpn.data password-flags = 2", "save temporary", "quit"].join("\n");
/** `save` succeeds even when a `set` before it was refused, and keeps the old value. */
export const nmEditWorked = (stdout: string) => /successfully updated/i.test(stdout) && !/Error:/.test(stdout.replace(/^nmcli> set vpn\.secrets.*$/gm, ""));

/** The editor drops the spaces around a value without saying so: better refused than sent altered. */
export const editorKeepsIntact = (password: string) => password === password.trim();

/** What NetworkManager's OpenVPN wrote since then. Only the journal says that a server refused: nmcli waits on. */
export const nmJournalArguments = (sinceSeconds: number) => ["-u", "NetworkManager", "--since", `@${sinceSeconds}`, "-o", "cat", "--no-pager"];
export const hasAuthFailure = (journal: string) => /AUTH_FAILED/.test(journal);

export const nmDownArguments = (uuid: string) => ["connection", "down", uuid];
export const nmDeleteArguments = (uuid: string) => ["connection", "delete", uuid];
export const NM_ACTIVE_ARGUMENTS = ["-t", "-f", "UUID,STATE", "connection", "show", "--active"];

/** What the server is sent as a password: its own rule for a token from the phone. */
export const fullPassword = (password: string, token: string | null) => `${password}${token ?? ""}`;

/** `lost`: it was up, then ended without being told to, such as when the gateway ends the session. */
export type VpnState = "connected" | "connecting" | "off" | "unavailable" | "lost";

export function parseNmActive(stdout: string): Map<string, VpnState> {
  const states = new Map<string, VpnState>();
  for (const line of stdout.split("\n")) {
    const [uuid, state] = line.trim().split(":");
    if (uuid && state) states.set(uuid, state === "activated" ? "connected" : "connecting");
  }
  return states;
}

const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;

/** `nordlayer status` is written for a person, with a spinner in front. */
export function parseNordStatus(stdout: string): { loggedIn: boolean; state: VpnState } {
  const text = stdout.replace(ANSI, "\n");
  const login = /^.*Login:\s*(.+)$/im.exec(text)?.[1] ?? "";
  const vpn = /^.*VPN:\s*(.+)$/im.exec(text)?.[1] ?? "";
  const state: VpnState = /^(not|dis)/i.test(vpn) || vpn === "" ? "off" : /connecting/i.test(vpn) ? "connecting" : "connected";
  return { loggedIn: login !== "" && !/^not/i.test(login), state };
}

/** `.ovpn` files lying in a folder, to be offered. */
export const ovpnFilesAmong = (files: string[]) => files.filter((file) => /\.ovpn$/i.test(file)).sort();

/** A name for files and for a sudo rule, whose names only take these characters. */
export function vpnSlug(name: string): string {
  const slug = name.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || "vpn";
}

export type SudoVpnPaths = { config: string; socket: string; rule: string };

/**
 * The file belongs to root, since whoever can change it could run anything as root through the rule.
 * The socket lies in the user's own folder of /run, which nobody else can open.
 */
export const sudoVpnPaths = (slug: string, uid: number): SudoVpnPaths => ({
  config: `/etc/openvpn/client/pm-${slug}.conf`,
  socket: `/run/user/${uid}/pm-vpn-${slug}.sock`,
  rule: `/etc/sudoers.d/pm-vpn-${slug}`,
});

/** Exactly what the sudo rule allows: not one argument can differ. */
export const sudoOpenvpnCommand = ({ config, socket }: SudoVpnPaths) => ["/usr/sbin/openvpn", "--config", config, "--auth-user-pass", "/dev/stdin", "--management", socket, "unix"];

/**
 * Read from the list of rules. `sudo -l <command>` will not do: it answers yes to anyone in the sudo
 * group, even for a command that would then ask for a password.
 */
export const sudoRuleInPlace = (listing: string, paths: SudoVpnPaths) => sudoRuleAllows(listing, sudoOpenvpnCommand(paths));

export function sudoRuleAllows(listing: string, command: string[]): boolean {
  const flat = listing.replace(/\s+/g, " ");
  return flat.includes(`NOPASSWD: ${command.join(" ")}`);
}

/** To paste once in a terminal: the app never writes in /etc by itself. */
export function sudoSetupCommands(source: string, paths: SudoVpnPaths, user: string): string[] {
  const file = `"${source.replace(/^~\//, "$HOME/")}"`;
  return [
    `sudo install -m 600 -o root -g root ${file} ${paths.config}`,
    `echo '${user} ALL=(root) NOPASSWD: ${sudoOpenvpnCommand(paths).join(" ")}' | sudo tee ${paths.rule} >/dev/null`,
    `sudo chmod 440 ${paths.rule}`,
    `sudo visudo -cf ${paths.rule}`,
  ];
}

export const sudoRemovalCommand = ({ config, rule }: SudoVpnPaths) => `sudo rm ${rule} ${config}`;

/** What the management socket answers to `state`: `time,CONNECTED,SUCCESS,…`. */
export function parseManagementState(answer: string): VpnState {
  const state = /^\d+,([A-Z_]+),/m.exec(answer)?.[1];
  if (!state) return "off";
  return state === "CONNECTED" ? "connected" : "connecting";
}

export type SudoLogEnd = "refused" | "ruleMissing" | "ended" | null;

export function readSudoLog(log: string): SudoLogEnd {
  if (/AUTH_FAILED/.test(log)) return "refused";
  // Any word of sudo itself means openvpn never started, in whatever language it says so.
  if (/^sudo:/m.test(log)) return "ruleMissing";
  if (/Exiting due to fatal error|process exiting|Options error/.test(log)) return "ended";
  return null;
}

/**
 * GlobalProtect, behind a Microsoft login: `gp-saml-gui` shows that login in a window of its own, and
 * hands back a cookie that openconnect takes as its password. A user like `DOMAIN\name` passes, since
 * it never reaches a command line: the root script reads it, and checks it again.
 */
export const isGpUsername = (value: string) => /^[A-Za-z0-9._@+\\-]+$/.test(value);

/** What the portal can answer, as openconnect's `--usergroup`. */
export const GP_COOKIE_KINDS = ["portal:prelogin-cookie", "portal:portal-userauthcookie", "gateway:prelogin-cookie"] as const;

/**
 * To the gateway, not the portal: a portal that hands its gateway over asks for a login again, which
 * openconnect could only read from an input that is already closed. With the gateway's cookie it
 * goes there straight.
 */
export const gpSamlArguments = (portal: string) => ["--gateway", "--clientos", "Linux", portal];

export type GpLogin = { user: string; group: string; cookie: string };

/** `gp-saml-gui` prints shell assignments, quoted by Python's `shlex.quote` when needed. */
export function parseGpSaml(stdout: string): GpLogin | null {
  const values = new Map<string, string>();
  for (const line of stdout.split("\n")) {
    const match = /^([A-Z]+)=(.*)$/.exec(line.trim());
    if (match) values.set(match[1], match[2].replace(/^'(.*)'$/, "$1"));
  }
  const user = values.get("USER") ?? "";
  const group = (values.get("HOST") ?? "").split("/").at(-1) ?? "";
  const cookie = values.get("COOKIE") ?? "";
  if (!isGpUsername(user) || !(GP_COOKIE_KINDS as readonly string[]).includes(group) || cookie === "" || !isOneLine(cookie)) return null;
  return { user, group, cookie };
}

/**
 * What of `gp-saml-gui`'s output may show in a message: it prints the cookie in several shapes, so
 * only its own log lines and Python's errors pass, and none that names a cookie.
 */
export const withoutCookies = (text: string) =>
  text
    .split("\n")
    .filter((line) => /^(\[[A-Z ]+\]|[A-Za-z.]*(Error|Exception)\b)/.test(line) && !/cookie/i.test(line))
    .join("\n");

export const gpScriptPath = (slug: string) => `/usr/local/sbin/pm-gp-${slug}`;

export type GpRoute = { address: string; mask: string; length: number };

/**
 * `192.168.200.0/24 10.1.0.0/16`, by spaces or commas, into networks. An address inside a network is
 * brought back to its start, as a route wants it. Null when one cannot be read.
 */
export function parseGpRoutes(value: string): GpRoute[] | null {
  const routes: GpRoute[] = [];
  for (const item of value.split(/[\s,]+/).filter(Boolean)) {
    const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?:\/(\d{1,2}))?$/.exec(item);
    if (!match) return null;
    const octets = match.slice(1, 5).map(Number);
    const length = match[5] === undefined ? 32 : Number(match[5]);
    if (octets.some((octet) => octet > 255) || length < 1 || length > 32) return null;
    const mask = length === 32 ? 0xffffffff : (0xffffffff << (32 - length)) >>> 0;
    const start = (((octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3]) & mask) >>> 0;
    const dotted = (n: number) => [24, 16, 8, 0].map((shift) => (n >>> shift) & 255).join(".");
    routes.push({ address: dotted(start), mask: dotted(mask), length });
  }
  return routes;
}

export const formatGpRoutes = (routes: GpRoute[]) => routes.map(({ address, length }) => `${address}/${length}`).join(" ");

/**
 * Called back by openconnect, with `reason` set, to set up the network: only these networks go
 * through the VPN, and the system keeps its own DNS, so that the rest of the machine stays online.
 * sudo clears the environment, so nobody can call this part by hand.
 */
function gpSplitLines(routes: GpRoute[]): string[] {
  if (routes.length === 0) return [];
  const variables = routes.flatMap(({ address, mask, length }, index) => [
    `CISCO_SPLIT_INC_${index}_ADDR=${address}`,
    `CISCO_SPLIT_INC_${index}_MASK=${mask}`,
    `CISCO_SPLIT_INC_${index}_MASKLEN=${length}`,
  ]);
  const names = ["CISCO_SPLIT_INC", ...variables.map((line) => line.split("=")[0])];
  return [
    'if [ -n "${reason:-}" ]; then',
    "  # Only these networks go through the VPN; the system keeps its own DNS.",
    `  CISCO_SPLIT_INC=${routes.length}`,
    ...variables.map((line) => `  ${line}`),
    `  export ${names.join(" ")}`,
    "  unset INTERNAL_IP4_DNS CISCO_DEF_DOMAIN CISCO_SPLIT_DNS INTERNAL_IP6_ADDRESS INTERNAL_IP6_NETMASK CISCO_IPV6_SPLIT_INC",
    "  exec /usr/share/vpnc-scripts/vpnc-script",
    "fi",
  ];
}

/**
 * Owned by root, and the only thing the sudo rule allows, without any argument. It takes the user,
 * the kind of cookie and the cookie on its input, and lets only the expected shapes through. The
 * report the gateway may ask for is made by openconnect's own script, as nobody.
 */
export function gpScript(slug: string, portal: string, routes: GpRoute[] = []): string {
  const split = routes.length > 0 ? ` --script=${gpScriptPath(slug)}` : "";
  return [
    "#!/bin/sh",
    "# Written by project-manager: one GlobalProtect portal, behind a Microsoft login.",
    "set -eu",
    ...gpSplitLines(routes),
    "IFS= read -r user",
    "IFS= read -r group",
    `case "$user" in ''|*[!A-Za-z0-9._@+\\\\-]*) echo "pm-gp: invalid user" >&2; exit 2 ;; esac`,
    `case "$group" in ${GP_COOKIE_KINDS.join("|")}) ;; *) echo "pm-gp: invalid cookie kind" >&2; exit 2 ;; esac`,
    `exec /usr/sbin/openconnect --protocol=gp --useragent='PAN GlobalProtect' --os=linux-64 --csd-user=nobody --csd-wrapper=/usr/libexec/openconnect/hipreport.sh${split} --user="$user" --usergroup="$group" --passwd-on-stdin ${portal}`,
    "",
  ].join("\n");
}

/** What sudo runs: `""` in the rule forbids any argument. */
export const sudoGpCommand = (slug: string) => [gpScriptPath(slug)];
export const gpRuleCommand = (slug: string) => [gpScriptPath(slug), '""'];

export function gpSetupCommands(slug: string, rule: string, portal: string, routes: GpRoute[], user: string): string[] {
  const script = gpScriptPath(slug);
  return [
    `sudo tee ${script} >/dev/null <<'PM_GP'\n${gpScript(slug, portal, routes)}PM_GP`,
    `sudo chmod 755 ${script}`,
    `echo '${user} ALL=(root) NOPASSWD: ${gpRuleCommand(slug).join(" ")}' | sudo tee ${rule} >/dev/null`,
    `sudo chmod 440 ${rule}`,
    `sudo visudo -cf ${rule}`,
  ];
}

export const gpRemovalCommand = (slug: string, rule: string) => `sudo rm ${rule} ${gpScriptPath(slug)}`;

export type GpLogEnd = "refused" | "ruleMissing" | "connected" | "ended" | null;

/**
 * What openconnect wrote, in English since it runs with `LC_ALL=C`. A refusal is checked first,
 * since a later line may come after it.
 */
export function readGpLog(log: string): GpLogEnd {
  if (/Failed to complete authentication|Invalid username or password|Authentication failed|auth-failed|Login failed/i.test(log)) return "refused";
  if (/^sudo:/m.test(log)) return "ruleMissing";
  if (/Session terminated by server/.test(log)) return "ended";
  if (/^Configured as /m.test(log)) return "connected";
  return null;
}

/** Whether openconnect got as far as being up: an end after that was not a failed attempt. */
export const gpWasConnected = (log: string) => /^Configured as /m.test(log);

/** `/proc/<pid>/cmdline` of a sudo the app started for GlobalProtect: anything else with that pid is not it. */
export const isOwnSudo = (cmdline: string) => cmdline.startsWith(["sudo", "-n", gpScriptPath("")].join("\0"));
