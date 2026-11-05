import { describe, expect, it } from "vitest";
import { editorKeepsIntact, parseManagementState, readSudoLog, sudoOpenvpnCommand, sudoRemovalCommand, sudoSetupCommands, sudoVpnPaths, vpnSlug, fullPassword, hasAuthFailure, isGateway, isOneLine, isOvpnPath, isVpnUsername, NM_RELEASE_SECRET_SCRIPT, nmEditArguments, nmEditWorked, nmHoldSecretScript, nmSetupArguments, nmUpArguments, ovpnFilesAmong, ovpnForImport, parseImportedUuid, parseNmActive, parseNordStatus } from "./vpn";

describe("what can be declared", () => {
  it("wants a .ovpn file, from the root or home", () => {
    expect(isOvpnPath("~/Projects/villette.ovpn")).toBe(true);
    expect(isOvpnPath("/etc/x.OVPN")).toBe(true);
    for (const bad of ["villette.ovpn", "~/x.conf", "/a\nb.ovpn"]) expect(isOvpnPath(bad)).toBe(false);
  });

  it("refuses what would change a list of nmcli", () => {
    expect(isVpnUsername("jean.dupont@x")).toBe(true);
    for (const bad of ["a b", "a,password-flags=0", "a=b", `a"`, ""]) expect(isVpnUsername(bad)).toBe(false);
    expect(isGateway("fr-paris.1")).toBe(true);
    expect(isGateway("--help")).toBe(false);
    expect(isOneLine("a b")).toBe(true);
    expect(isOneLine("a\nvpn.secrets.x:y")).toBe(false);
  });
});

describe("ovpnForImport", () => {
  it("drops only the route NetworkManager refuses, keeping the line numbers", () => {
    const file = "client\nroute remote_host 255.255.255.255 net_gateway\nroute 10.0.0.0 255.0.0.0\n<key>\nroute remote_host\n</key>\n";
    const lines = ovpnForImport(file).split("\n");
    expect(lines).toHaveLength(file.split("\n").length);
    expect(lines[1]).toMatch(/^#/);
    expect(lines[2]).toBe("route 10.0.0.0 255.0.0.0");
    expect(ovpnForImport("client\nremote x\n")).toBe("client\nremote x\n");
  });
});

describe("nmcli", () => {
  it("reads the profile it made", () => {
    expect(parseImportedUuid("Connection 'villette' (6f1b0c3e-1a2b-4c3d-8e4f-0123456789ab) successfully added.\n")).toBe("6f1b0c3e-1a2b-4c3d-8e4f-0123456789ab");
    expect(parseImportedUuid("nope")).toBeNull();
  });

  it("keeps the password out of NetworkManager, and never connects alone", () => {
    const args = nmSetupArguments("u", "Villette", "me");
    expect(args).toEqual(expect.arrayContaining(["connection.autoconnect", "no", "username=me", "password-flags=2", "connection.id", "Villette"]));
    expect(nmSetupArguments("u", "V", null)).not.toContain("username=null");
  });

  it("holds the secret through the editor, in memory only, and lets go of it", () => {
    expect(nmEditArguments("u").join(" ")).not.toContain("secret");
    expect(nmEditArguments("u").at(-1)).toBe("u");
    const script = nmHoldSecretScript("p w");
    expect(script.split("\n")).toEqual(["set vpn.data password-flags = 0", "set vpn.secrets password = p w", "save temporary", "quit"]);
    expect(nmHoldSecretScript("a\\b,c").split("\n")[1]).toBe("set vpn.secrets password = a\\\\b\\,c");
    expect(NM_RELEASE_SECRET_SCRIPT).toContain("remove vpn.secrets");
    expect(NM_RELEASE_SECRET_SCRIPT).toContain("password-flags = 2");
    expect(NM_RELEASE_SECRET_SCRIPT).toContain("save temporary");
    expect(nmEditWorked("Connection 'x' (u) successfully updated.")).toBe(true);
    expect(nmEditWorked("Error: x")).toBe(false);
    expect(nmEditWorked("nmcli> set vpn.secrets password = Error: mine\nConnection 'x' (u) successfully updated.")).toBe(true);
    expect(nmEditWorked("Error: failed to set 'secrets' property\nConnection 'x' (u) successfully updated.")).toBe(false);
    expect(editorKeepsIntact("a b")).toBe(true);
    expect(editorKeepsIntact("a ")).toBe(false);
  });

  it("connects with nothing secret on its command line", () => {
    expect(nmUpArguments("u", 45)).toEqual(["--wait", "45", "connection", "up", "u"]);
  });

  it("reads which profiles are up", () => {
    const states = parseNmActive("aaa:activated\nbbb:activating\n\n");
    expect(states.get("aaa")).toBe("connected");
    expect(states.get("bbb")).toBe("connecting");
    expect(states.get("ccc")).toBeUndefined();
  });
});

describe("hasAuthFailure", () => {
  it("recognizes a refusal in the journal", () => {
    expect(hasAuthFailure("AUTH: Received control message: AUTH_FAILED\n")).toBe(true);
    expect(hasAuthFailure("Peer Connection Initiated\n")).toBe(false);
  });
});

describe("the token", () => {
  it("comes right after the password", () => {
    expect(fullPassword("secret", "123456")).toBe("secret123456");
    expect(fullPassword("secret", null)).toBe("secret");
  });
});

describe("parseNordStatus", () => {
  it("reads through its warning and its spinner", () => {
    const off = "\x1b[1;33mThe app version you are using\n\x1b[0m\n\x1b[2K[-] Getting status...\x1b[2KLogin: Not logged in\nVPN: Not Connected\nCurrent network: Home\n";
    expect(parseNordStatus(off)).toEqual({ loggedIn: false, state: "off" });
  });

  it("takes anything else as connected", () => {
    expect(parseNordStatus("Login: me@x.fr\nVPN: Connected to fr-paris\n")).toEqual({ loggedIn: true, state: "connected" });
    expect(parseNordStatus("Login: me\nVPN: Connecting\n").state).toBe("connecting");
    expect(parseNordStatus("Login: me\nVPN: Disconnected\n").state).toBe("off");
    expect(parseNordStatus("").state).toBe("off");
  });
});

describe("ovpnFilesAmong", () => {
  it("offers only these", () => expect(ovpnFilesAmong(["b.ovpn", "a.OVPN", "x.txt"])).toEqual(["a.OVPN", "b.ovpn"]));
});

describe("OpenVPN through sudo", () => {
  const paths = sudoVpnPaths("la-villette", 1000);

  it("names files only with safe characters", () => {
    expect(vpnSlug("La Villette")).toBe("la-villette");
    expect(vpnSlug("  Été/../x  ")).toBe("ete-x");
    expect(vpnSlug("!!!")).toBe("vpn");
  });

  it("runs exactly what the rule allows, without any secret", () => {
    const command = sudoOpenvpnCommand(paths);
    expect(command).toEqual(["/usr/sbin/openvpn", "--config", "/etc/openvpn/client/pm-la-villette.conf", "--auth-user-pass", "/dev/stdin", "--management", "/run/user/1000/pm-vpn-la-villette.sock", "unix"]);
    expect(sudoSetupCommands("~/Projects/v.ovpn", paths, "me")[1]).toContain(`me ALL=(root) NOPASSWD: ${command.join(" ")}`);
  });

  it("gives the file to root, and checks the rule", () => {
    const [install, , chmod, check] = sudoSetupCommands("~/My Files/v.ovpn", paths, "me");
    expect(install).toBe('sudo install -m 600 -o root -g root "$HOME/My Files/v.ovpn" /etc/openvpn/client/pm-la-villette.conf');
    expect(chmod).toContain("440");
    expect(check).toContain("visudo -cf");
    expect(sudoRemovalCommand(paths)).toBe("sudo rm /etc/sudoers.d/pm-vpn-la-villette /etc/openvpn/client/pm-la-villette.conf");
  });

  it("reads the state from the socket", () => {
    expect(parseManagementState(">INFO:OpenVPN Management\n1793888000,CONNECTED,SUCCESS,10.0.0.2,1.2.3.4\nEND\n")).toBe("connected");
    expect(parseManagementState("1793888000,TCP_CONNECT,,,\nEND\n")).toBe("connecting");
    expect(parseManagementState("")).toBe("off");
  });

  it("reads why it ended from its output", () => {
    expect(readSudoLog("x AUTH: Received control message: AUTH_FAILED\n")).toBe("refused");
    expect(readSudoLog("sudo: a password is required\n")).toBe("ruleMissing");
    expect(readSudoLog("sudo: il est nécessaire de saisir un mot de passe\n")).toBe("ruleMissing");
    expect(readSudoLog("Options error: x\n")).toBe("ended");
    expect(readSudoLog("Initialization Sequence Completed\n")).toBeNull();
  });
});
