/** What can be declared about a VPN, and how the commands that drive it are built. No I/O here. */

export const isOvpnPath = (value: string) => /^(~\/|\/)[^\0\n]+\.ovpn$/i.test(value);
/** It goes in a `key=value` list of nmcli, which gives these characters a meaning. */
export const isVpnUsername = (value: string) => /^[^\s,=\\'"]+$/.test(value);
export const isGateway = (value: string) => /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value);
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

export type VpnState = "connected" | "connecting" | "off" | "unavailable";

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
