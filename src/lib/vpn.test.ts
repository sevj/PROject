import { describe, expect, it } from "vitest";
import { editorKeepsIntact, formatGpRoutes, parseGpRoutes, gpRemovalCommand, gpRuleCommand, gpScript, gpSetupCommands, isOwnSudo, parseGpSaml, readGpLog, sudoGpCommand, sudoRuleAllows, withoutCookies, parseManagementState, readSudoLog, sudoOpenvpnCommand, sudoRemovalCommand, sudoRuleInPlace, sudoSetupCommands, sudoVpnPaths, vpnSlug, fullPassword, hasAuthFailure, isGateway, isOneLine, isOrganization, isOvpnPath, isVpnUsername, nordLoginArguments, NM_RELEASE_SECRET_SCRIPT, nmEditArguments, nmEditWorked, nmHoldSecretScript, nmSetupArguments, nmUpArguments, ovpnFilesAmong, ovpnForImport, parseImportedUuid, parseNmActive, parseNordStatus } from "./vpn";

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

  it("wants this very rule, not a yes for the sudo group or the rule of another VPN", () => {
    const rule = `    (root) NOPASSWD: ${sudoOpenvpnCommand(paths).join(" ")}`;
    expect(sudoRuleInPlace(`User me may run:\n    (ALL : ALL) ALL\n${rule}\n`, paths)).toBe(true);
    expect(sudoRuleInPlace("User me may run:\n    (ALL : ALL) ALL\n", paths)).toBe(false);
    expect(sudoRuleInPlace(rule, sudoVpnPaths("semardel", 1000))).toBe(false);
    expect(sudoRuleInPlace("sudo: a password is required", paths)).toBe(false);
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

describe("nordLoginArguments", () => {
  it("goes straight to the organization when there is one", () => {
    expect(nordLoginArguments("adimeo_fr")).toEqual(["login", "--organization", "adimeo_fr"]);
    expect(nordLoginArguments(null)).toEqual(["login"]);
    expect(isOrganization("adimeo_fr")).toBe(true);
    expect(isOrganization("--email=x")).toBe(false);
  });
});

describe("GlobalProtect", () => {
  const saml = "HOST=https://vpn.corp.fr/portal:prelogin-cookie\nUSER='GROUPE-GT\\j.dupont'\nCOOKIE='Tmq+GU/x=='\nOS=linux-64\n";

  it("reads what gp-saml-gui prints, quoted or not", () => {
    expect(parseGpSaml(saml)).toEqual({ user: "GROUPE-GT\\j.dupont", group: "portal:prelogin-cookie", cookie: "Tmq+GU/x==" });
    expect(parseGpSaml("HOST=https://vpn.corp.fr/gateway:prelogin-cookie\nUSER=jd\nCOOKIE=abc\n")).toMatchObject({ user: "jd", group: "gateway:prelogin-cookie" });
    expect(parseGpSaml(saml.replace("portal:prelogin-cookie", "portal:x;id"))).toBeNull();
    expect(parseGpSaml(saml.replace("j.dupont", "j dupont"))).toBeNull();
    expect(parseGpSaml("")).toBeNull();
  });

  it("keeps the cookie out of a message", () => {
    const err = "[PAGE   ] Finished loading page https://login.microsoftonline.com/x\n[SAML   ] Got SAML result headers: {'prelogin-cookie': 'Tmq'}\n    echo Tmq |\n        sudo openconnect --protocol=gp\n";
    expect(withoutCookies(err)).not.toContain("Tmq");
    expect(withoutCookies(err)).toContain("Finished loading page");
  });

  it("allows one root script, without any argument, which fixes the portal", () => {
    expect(sudoGpCommand("corp")).toEqual(["/usr/local/sbin/pm-gp-corp"]);
    const commands = gpSetupCommands("corp", "/etc/sudoers.d/pm-vpn-corp", "vpn.corp.fr", [], "me");
    expect(commands[0]).toBe(`sudo tee /usr/local/sbin/pm-gp-corp >/dev/null <<'PM_GP'\n${gpScript("corp", "vpn.corp.fr")}PM_GP`);
    expect(commands).toContain(`echo 'me ALL=(root) NOPASSWD: /usr/local/sbin/pm-gp-corp ""' | sudo tee /etc/sudoers.d/pm-vpn-corp >/dev/null`);
    expect(gpScript("corp", "vpn.corp.fr")).toMatch(/--passwd-on-stdin vpn\.corp\.fr\n$/);
    expect(gpScript("corp", "vpn.corp.fr")).not.toContain("--script");
    expect(gpRemovalCommand("corp", "/etc/sudoers.d/pm-vpn-corp")).toBe("sudo rm /etc/sudoers.d/pm-vpn-corp /usr/local/sbin/pm-gp-corp");
    expect(sudoRuleAllows('    (root) NOPASSWD: /usr/local/sbin/pm-gp-corp ""\n', gpRuleCommand("corp"))).toBe(true);
    expect(sudoRuleAllows("    (root) NOPASSWD: /usr/local/sbin/pm-gp-corp\n", gpRuleCommand("corp"))).toBe(false);
  });

  it("reads how openconnect went", () => {
    expect(readGpLog("POST https://vpn.corp.fr/ssl-vpn/login.esp\nConfigured as 10.1.2.3, with SSL connected and ESP in progress\n")).toBe("connected");
    expect(readGpLog("Configured as 10.1.2.3\nSession terminated by server; exiting.\n")).toBe("ended");
    expect(readGpLog("Failed to complete authentication\n")).toBe("refused");
    expect(readGpLog("sudo: a password is required\n")).toBe("ruleMissing");
    expect(readGpLog("POST https://vpn.corp.fr/global-protect/prelogin.esp\n")).toBeNull();
  });

  it("recognizes only the sudo it started", () => {
    expect(isOwnSudo(["sudo", "-n", "/usr/local/sbin/pm-gp-corp", ""].join("\0"))).toBe(true);
    expect(isOwnSudo(["sudo", "-n", "/usr/sbin/openvpn", "--config", "x", ""].join("\0"))).toBe(false);
    expect(isOwnSudo("bash\0")).toBe(false);
  });

  it("reads the networks to send through it, brought back to their start", () => {
    expect(parseGpRoutes(" 192.168.200.37/24, 10.1.0.0/16 10.5.18.28 ")).toEqual([
      { address: "192.168.200.0", mask: "255.255.255.0", length: 24 },
      { address: "10.1.0.0", mask: "255.255.0.0", length: 16 },
      { address: "10.5.18.28", mask: "255.255.255.255", length: 32 },
    ]);
    expect(parseGpRoutes("")).toEqual([]);
    for (const bad of ["192.168.200.0/33", "300.1.1.1", "10.0.0.0/0", "vpn.corp.fr", "1.2.3.4/24;id"]) expect(parseGpRoutes(bad)).toBeNull();
    expect(formatGpRoutes(parseGpRoutes("192.168.200.37/24 10.5.18.28") ?? [])).toBe("192.168.200.0/24 10.5.18.28/32");
  });

  it("sends only those networks through the tunnel, and keeps the system's DNS", () => {
    const script = gpScript("corp", "vpn.corp.fr", parseGpRoutes("192.168.200.0/24") ?? []);
    expect(script).toContain("--script=/usr/local/sbin/pm-gp-corp ");
    expect(script).toContain("CISCO_SPLIT_INC=1\n  CISCO_SPLIT_INC_0_ADDR=192.168.200.0\n  CISCO_SPLIT_INC_0_MASK=255.255.255.0\n  CISCO_SPLIT_INC_0_MASKLEN=24\n");
    expect(script).toContain("unset INTERNAL_IP4_DNS");
    expect(script.indexOf("exec /usr/share/vpnc-scripts/vpnc-script")).toBeLessThan(script.indexOf("read -r user"));
  });
});
