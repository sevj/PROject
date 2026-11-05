import { describe, expect, it } from "vitest";
import {
  isContainerName,
  isHost,
  isJumpHost,
  isKubeTarget,
  isNamespace,
  isPort,
  isRemotePath,
  isUsername,
  isWebUrl,
  kubeClusterArguments,
  kubeTargetArguments,
  looksLikeProduction,
  parseSshAliases,
  readKubeExit,
  privateKeysAmong,
  readSshExit,
  sshArguments,
  sshProbe,
  type SshTarget,
} from "./remote-servers";

const target: SshTarget = { host: "srv1", port: 2222, username: "deploy", auth: "agent", keyPath: null, jumpHost: null };

describe("what can be declared", () => {
  it("refuses what could be read as an option or by a shell", () => {
    for (const bad of ["-oProxyCommand=x", "a b", "a;b", "$(x)", ""]) {
      expect(isHost(bad)).toBe(false);
      expect(isUsername(bad)).toBe(false);
      expect(isJumpHost(bad)).toBe(false);
    }
    expect(isHost("srv-1.example.fr")).toBe(true);
    expect(isHost("2001:db8::1")).toBe(true);
    expect(isJumpHost("me@bastion:2222")).toBe(true);
  });

  it("checks ports and Kubernetes names", () => {
    expect([0, 22, 65536, 1.5].map(isPort)).toEqual([false, true, false, false]);
    expect(isNamespace("my-ns")).toBe(true);
    expect(isNamespace("-x")).toBe(false);
    expect(isContainerName("php")).toBe(true);
    expect(isContainerName("a b")).toBe(false);
  });

  it("takes a workload or labels, not a pod's name that will change", () => {
    for (const good of ["deployment/api", "statefulset/db", "daemonset/x", "app=api", "app.kubernetes.io/name=api,tier=web"]) {
      expect(isKubeTarget(good)).toBe(true);
    }
    for (const bad of ["pod/api-7f9c", "api", "--all-namespaces", "deployment/", "a=b;c"]) expect(isKubeTarget(bad)).toBe(false);
  });

  it("wants an absolute folder", () => {
    expect(isRemotePath("/var/www/app")).toBe(true);
    expect(isRemotePath("~/app")).toBe(false);
    expect(isRemotePath("app")).toBe(false);
  });

  it("only opens web addresses", () => {
    expect(isWebUrl("https://exemple.fr/admin")).toBe(true);
    expect(isWebUrl("http://localhost:3000")).toBe(true);
    for (const bad of ["javascript:alert(1)", "data:text/html,x", "file:///etc/passwd", "exemple.fr", ""]) expect(isWebUrl(bad)).toBe(false);
  });

  it("recognizes production, not what precedes it", () => {
    for (const name of ["Production", "prod", "PROD EU", "prod-eu", "site_prod"]) expect(looksLikeProduction(name)).toBe(true);
    for (const name of ["Préproduction", "preprod", "pre-prod", "Recette", "produit"]) expect(looksLikeProduction(name)).toBe(false);
  });
});

describe("sshArguments", () => {
  it("ends with the destination behind --, and never asks anything", () => {
    const args = sshArguments(target, "true", "/home/me");
    expect(args).toContain("BatchMode=yes");
    expect(args.slice(-3)).toEqual(["--", "srv1", "true"]);
    expect(args).toEqual(expect.arrayContaining(["-p", "2222", "-l", "deploy"]));
  });

  it("uses only the given key, with its home expanded", () => {
    const args = sshArguments({ ...target, auth: "key", keyPath: "~/.ssh/id_rsa" }, "true", "/home/me");
    expect(args).toEqual(expect.arrayContaining(["-i", "/home/me/.ssh/id_rsa", "-o", "IdentitiesOnly=yes"]));
  });

  it("lets the user's config decide everything for an alias", () => {
    const args = sshArguments({ ...target, auth: "alias", jumpHost: "b" }, "true", "/home/me");
    for (const option of ["-p", "-l", "-J"]) expect(args).not.toContain(option);
  });

  it("answers one password prompt, and never holds the password", () => {
    const args = sshArguments({ ...target, auth: "password" }, "true", "/home/me");
    expect(args).not.toContain("BatchMode=yes");
    expect(args).toContain("NumberOfPasswordPrompts=1");
  });

  it("never accepts a host key on the user's behalf", () => {
    expect(sshArguments(target, "true", "/home/me").join(" ")).not.toContain("StrictHostKeyChecking");
  });
});

describe("sshProbe", () => {
  it("only looks, and quotes the folder", () => {
    expect(sshProbe(null)).toBe("true");
    expect(sshProbe("/var/www/it's; rm -rf /")).toBe(`test -d '/var/www/it'\\''s; rm -rf /'`);
  });
});

describe("readSshExit", () => {
  it("says what went wrong", () => {
    expect(readSshExit(0, "", false, false)).toBeNull();
    expect(readSshExit(null, "", false, false)).toBe("timeout");
    expect(readSshExit(5, "", true, false)).toBe("wrongPassword");
    expect(readSshExit(6, "", true, false)).toBe("unknownHostKey");
    expect(readSshExit(1, "", false, true)).toBe("folderMissing");
    expect(readSshExit(255, "Host key verification failed.", false, false)).toBe("unknownHostKey");
    expect(readSshExit(255, "me@srv: Permission denied (publickey).", false, false)).toBe("refused");
    expect(readSshExit(255, "ssh: connect to host x port 22: Connection refused", false, false)).toBe("unreachable");
    expect(readSshExit(255, "something else", false, false)).toBe("unknown");
  });
});

describe("kubectl", () => {
  it("always names its context and never changes the current one", () => {
    const all = [...kubeClusterArguments("prod"), ...kubeTargetArguments("prod", "ns", "deployment/api")];
    expect(all).toContain("--context=prod");
    expect(all).not.toContain("config");
    expect(all).not.toContain("use-context");
  });

  it("reads a workload or the first pod of a label", () => {
    expect(kubeTargetArguments("c", "ns", "deployment/api").slice(3)).toEqual(["get", "deployment/api", "-o", "jsonpath={.spec.template.spec.containers[*].name}"]);
    expect(kubeTargetArguments("c", null, "app=api").slice(2, 5)).toEqual(["get", "pods", "--selector=app=api"]);
  });
});

describe("readKubeExit", () => {
  it("says what went wrong", () => {
    expect(readKubeExit(0, "")).toBeNull();
    expect(readKubeExit(null, "")).toBe("timeout");
    expect(readKubeExit(1, 'error: context "x" does not exist')).toBe("contextMissing");
    expect(readKubeExit(1, 'Error from server (NotFound): deployments.apps "x" not found')).toBe("targetMissing");
    expect(readKubeExit(1, "error: error executing jsonpath: array index out of bounds: index 0")).toBe("targetMissing");
    expect(readKubeExit(1, "Error from server (Forbidden): pods is forbidden")).toBe("refused");
    expect(readKubeExit(1, "Unable to connect to the server: dial tcp")).toBe("unreachable");
  });
});

describe("suggestions", () => {
  it("keeps real SSH hosts", () => {
    expect(parseSshAliases("Host *\n  User x\nhost b a\n# Host no\nHost c?\nMatch all\n")).toEqual(["a", "b"]);
  });

  it("finds private keys by their public half", () => {
    expect(privateKeysAmong(["config", "id_rsa", "id_rsa.pub", "other.pub", "test.sh"])).toEqual(["id_rsa"]);
  });
});
