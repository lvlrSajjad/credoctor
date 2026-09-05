import { existsSync } from "node:fs";
import { CheckContext, Finding, Tree } from "./types.js";
import { expand, git, gitConfig, gitLocalConfig, run, tildify, which } from "./sys.js";
import { findRepos } from "./config.js";

const pass = (t: Tree, check: string, detail: string): Finding => ({ tree: t.name, check, status: "pass", detail });
const fail = (t: Tree, check: string, detail: string, remedy: string): Finding => ({ tree: t.name, check, status: "fail", detail, remedy });
const warn = (t: Tree, check: string, detail: string, remedy?: string): Finding => ({ tree: t.name, check, status: "warn", detail, remedy });
const skip = (t: Tree, check: string, detail: string): Finding => ({ tree: t.name, check, status: "skip", detail });

/** A representative repo inside the tree — conditional includes only apply inside one. */
function anyRepo(t: Tree): string | null {
  const repos = findRepos(t.path);
  return repos.length ? repos[0] : null;
}

function checkIdentity(t: Tree): Finding[] {
  const dir = expand(t.path);
  if (!existsSync(dir)) return [fail(t, "tree-exists", `${t.path} does not exist`, "Fix the path in credkit.json, or create the tree.")];
  const repo = anyRepo(t);
  if (!repo) return [skip(t, "identity", `no git repo under ${t.path} yet`)];

  const email = gitConfig(repo, "user.email");
  const name = gitConfig(repo, "user.name");
  if (email === t.git.email && (!t.git.name || name === t.git.name)) {
    return [pass(t, "identity", `${name ?? "?"} <${email}>`)];
  }
  return [
    fail(
      t,
      "identity",
      `resolves to ${name ?? "?"} <${email ?? "unset"}>, expected ${t.git.name ?? "?"} <${t.git.email}>`,
      `Add an includeIf for ${t.path} in ~/.gitconfig pointing at a file that sets user.name and user.email.`,
    ),
  ];
}

/**
 * A repo's *local* config beats a conditional include silently. This is the check that
 * catches "I set up includeIf and it still commits as the wrong person".
 */
function checkLocalOverrides(t: Tree): Finding[] {
  const offenders: string[] = [];
  for (const repo of findRepos(t.path)) {
    const local = gitLocalConfig(repo, "user.email");
    if (local && local !== t.git.email) offenders.push(`${tildify(repo)} (${local})`);
  }
  if (!offenders.length) return [pass(t, "no-local-override", "no repo overrides the tree identity")];
  return [
    fail(
      t,
      "no-local-override",
      `${offenders.length} repo(s) override it: ${offenders.slice(0, 3).join(", ")}${offenders.length > 3 ? " …" : ""}`,
      "Clear the stale value so the tree default applies: git -C <repo> config --local --unset user.email (and user.name).",
    ),
  ];
}

function checkSigning(t: Tree): Finding[] {
  if (!t.signingKey) return [skip(t, "signing", "no signing key configured for this tree")];
  const out: Finding[] = [];
  const repo = anyRepo(t);

  const g = run("gpg", ["--list-keys", "--with-colons", t.signingKey]);
  if (!g.ok) {
    out.push(fail(t, "signing-key-present", `gpg does not know key ${t.signingKey}`, "Import or generate the key, then set user.signingkey for this tree."));
    return out;
  }
  const lines = g.stdout.split("\n");
  const uidEmails = lines.filter((l) => l.startsWith("uid:")).map((l) => l.split(":")[9] ?? "").join(" ");
  if (uidEmails.includes(t.git.email)) {
    out.push(pass(t, "signing-key-email", `key ${t.signingKey} is bound to ${t.git.email}`));
  } else {
    out.push(
      fail(
        t,
        "signing-key-email",
        `key ${t.signingKey} has no UID for ${t.git.email}`,
        "GitHub matches the key UID against the committer email — generate a key for this address rather than reusing another tree's.",
      ),
    );
  }

  const pub = lines.find((l) => l.startsWith("pub:"));
  const expiry = pub?.split(":")[6];
  if (expiry && Number(expiry) * 1000 < Date.now()) {
    out.push(fail(t, "signing-key-expiry", `key expired ${new Date(Number(expiry) * 1000).toISOString().slice(0, 10)}`, "Extend it: gpg --quick-set-expire <fingerprint> 2y"));
  } else if (expiry) {
    out.push(pass(t, "signing-key-expiry", `expires ${new Date(Number(expiry) * 1000).toISOString().slice(0, 10)}`));
  }

  if (repo) {
    const on = gitConfig(repo, "commit.gpgsign");
    out.push(on === "true" ? pass(t, "signing-enabled", "commit.gpgsign is on") : fail(t, "signing-enabled", `commit.gpgsign is ${on ?? "unset"}`, "Set commit.gpgsign = true in this tree's include file."));
  }
  return out;
}

/** Remotes that bypass the tree's alias fall back to whatever shared credential exists. */
function checkRemotes(t: Tree): Finding[] {
  if (!t.sshAlias) return [skip(t, "remote-alias", "no sshAlias configured")];
  const bad: string[] = [];
  let total = 0;
  for (const repo of findRepos(t.path)) {
    const url = git(repo, "ls-remote", "--get-url", "origin").stdout;
    if (!url || url === "origin") continue;
    total++;
    if (!url.startsWith(`git@${t.sshAlias}:`)) bad.push(`${tildify(repo)} -> ${url}`);
  }
  if (!total) return [skip(t, "remote-alias", "no repos with an origin remote")];
  if (!bad.length) return [pass(t, "remote-alias", `${total} repo(s) all use git@${t.sshAlias}`)];
  return [
    fail(
      t,
      "remote-alias",
      `${bad.length}/${total} bypass the alias: ${bad.slice(0, 2).join(", ")}${bad.length > 2 ? " …" : ""}`,
      `Point them at the alias so they cannot pick up another tree's credential: git -C <repo> remote set-url origin git@${t.sshAlias}:<org>/<repo>.git`,
    ),
  ];
}

function checkSsh(t: Tree): Finding[] {
  if (!t.sshAlias) return [skip(t, "ssh-identity", "no sshAlias configured")];
  const r = run("ssh", ["-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=accept-new", "-T", `git@${t.sshAlias}`], { timeoutMs: 25_000 });
  const greeting = `${r.stdout}\n${r.stderr}`.match(/Hi ([A-Za-z0-9-]+)!/)?.[1];
  if (!greeting) {
    return [fail(t, "ssh-identity", `no greeting from git@${t.sshAlias}: ${(r.stderr || r.stdout).split("\n")[0]}`, `Check the Host ${t.sshAlias} block in ~/.ssh/config and that its key is registered on the account.`)];
  }
  if (t.sshAccount && greeting !== t.sshAccount) {
    return [fail(t, "ssh-identity", `greeted as ${greeting}, expected ${t.sshAccount}`, `The IdentityFile for Host ${t.sshAlias} belongs to the wrong account. Add IdentitiesOnly yes so no other key is offered.`)];
  }
  return [pass(t, "ssh-identity", `greeted as ${greeting}`)];
}

/**
 * The check nothing else does: a key can authenticate perfectly and still be refused by an
 * SSO-enforcing org until it is separately authorized. Only a real fetch reveals it.
 */
function checkReachable(t: Tree): Finding[] {
  const repo = anyRepo(t);
  if (!repo) return [skip(t, "remote-reachable", "no repo to test")];
  const r = git(repo, "ls-remote", "-h", "origin");
  if (r.ok) return [pass(t, "remote-reachable", `${tildify(repo)} reachable`)];
  const err = `${r.stderr}\n${r.stdout}`;
  if (/SAML|SSO/i.test(err)) {
    const org = t.orgs?.[0] ?? "the org";
    return [fail(t, "remote-reachable", `${org} enforces SAML SSO and this key is not authorized`, "GitHub → Settings → SSH and GPG keys → the key → Configure SSO → Authorize. A key and a token authorize separately; doing one does not do the other.")];
  }
  const url = git(repo, "ls-remote", "--get-url", "origin").stdout;
  const remedy = /github\.com|github-/.test(url)
    ? "Confirm the key is registered on the expected account and has access to this repository."
    : `Not a GitHub remote (${url.replace(/^https:\/\/[^@]*@/, "https://")}) — check that host's own credentials; credkit only understands GitHub auth today.`;
  return [fail(t, "remote-reachable", err.split("\n").find(Boolean) ?? "ls-remote failed", remedy)];
}

function ghEnv(t: Tree): Record<string, string> | undefined {
  return t.ghConfigDir ? { GH_CONFIG_DIR: expand(t.ghConfigDir) } : undefined;
}

function checkGhAccount(t: Tree): Finding[] {
  if (!t.ghConfigDir) return [skip(t, "gh-account", "no ghConfigDir configured")];
  if (!which("gh")) return [skip(t, "gh-account", "gh not installed")];
  const r = run("gh", ["auth", "status"], { env: ghEnv(t) });
  const acct = `${r.stdout}\n${r.stderr}`.match(/account ([A-Za-z0-9-]+)/)?.[1];
  if (!acct) return [fail(t, "gh-account", `no account in ${t.ghConfigDir}`, `Log in to that store: GH_CONFIG_DIR=${t.ghConfigDir} gh auth login`)];
  if (t.ghAccount && acct !== t.ghAccount) {
    return [fail(t, "gh-account", `store resolves to ${acct}, expected ${t.ghAccount}`, "The store's token does not match its hosts.yml. Re-run gh auth login for this store.")];
  }
  return [pass(t, "gh-account", `${acct} (${t.ghConfigDir})`)];
}

/**
 * Probe *real repositories* rather than `GET /orgs/<name>`.
 *
 * That endpoint returns public org metadata to any authenticated user, so it answers
 * "does this org exist", not "can this token reach it" — and it 404s outright for
 * user-owned repos, where there is no org at all. Only asking for a specific repository
 * tests what we actually care about.
 */
function probeRepos(t: Tree): string[] {
  const out = new Set<string>();
  for (const repo of findRepos(t.path)) {
    const url = git(repo, "ls-remote", "--get-url", "origin").stdout;
    const m =
      url.match(/^git@[^:]*github[^:]*:([^/]+)\/(.+?)(?:\.git)?$/) ??
      url.match(/^https:\/\/(?:[^@]*@)?github\.com\/([^/]+)\/(.+?)(?:\.git)?$/);
    if (m) out.add(`${m[1]}/${m[2]}`);
  }
  return [...out];
}

function checkGhOrgs(t: Tree, all: Tree[]): Finding[] {
  if (!t.ghConfigDir) return [skip(t, "gh-org-access", "no ghConfigDir configured")];
  if (!which("gh")) return [skip(t, "gh-org-access", "gh not installed")];
  const mine = probeRepos(t);
  if (!mine.length) return [skip(t, "gh-org-access", "no GitHub remotes in this tree")];

  const env = ghEnv(t);
  const canReach = (nwo: string) => run("gh", ["api", `repos/${nwo}`], { env }).ok;

  const out: Finding[] = [];
  const unreachable = mine.filter((r) => !canReach(r));
  out.push(
    unreachable.length
      ? fail(
          t,
          "gh-org-access",
          `token cannot reach ${unreachable.slice(0, 2).join(", ")}${unreachable.length > 2 ? " …" : ""}`,
          "Either the token lacks access, or it is not SSO-authorized for that org. Re-run gh auth login and accept the org authorization prompt.",
        )
      : pass(t, "gh-org-access", `reaches ${mine.length} repo(s), e.g. ${mine[0]}`),
  );

  // Isolation: this token must NOT reach repositories belonging to another tree.
  // Trees that deliberately share an account (several personal trees, say) are not
  // isolated from each other by design — only cross-check trees meant to be separate.
  const others = all.filter(
    (o) => o.name !== t.name && (o.ghAccount ?? o.ghConfigDir) !== (t.ghAccount ?? t.ghConfigDir),
  );
  const foreign = [...new Set(others.flatMap(probeRepos))].filter((r) => !mine.includes(r));
  if (foreign.length) {
    const leaked = foreign.filter(canReach);
    out.push(
      leaked.length
        ? warn(
            t,
            "gh-org-isolation",
            `also reaches another tree's repo: ${leaked.slice(0, 2).join(", ")}`,
            "If these are meant to be separate identities, one account has access it should not.",
          )
        : pass(t, "gh-org-isolation", `denied all ${foreign.length} repo(s) belonging to other trees`),
    );
  }
  return out;
}

/** Two trees sharing a credential means one login can break the other. */
function checkCollisions(trees: Tree[]): Finding[] {
  const out: Finding[] = [];
  const groups: Array<[keyof Tree, string]> = [
    ["sshAlias", "SSH alias"],
    ["ghConfigDir", "gh store"],
    ["signingKey", "signing key"],
  ];
  for (const [key, label] of groups) {
    const seen = new Map<string, string[]>();
    for (const t of trees) {
      const v = t[key] as string | undefined;
      if (!v) continue;
      seen.set(v, [...(seen.get(v) ?? []), t.name]);
    }
    for (const [value, owners] of seen) {
      if (owners.length > 1) {
        out.push({
          tree: owners.join("+"),
          check: "no-shared-credential",
          status: "warn",
          detail: `${owners.join(" and ")} share the same ${label} (${value})`,
          remedy: `Give each tree its own ${label}, or they cannot fail independently.`,
        });
      }
    }
  }
  if (!out.length) out.push({ tree: "-", check: "no-shared-credential", status: "pass", detail: "no SSH alias, gh store or signing key is shared between trees" });
  return out;
}

export function runChecks(ctx: CheckContext): Finding[] {
  const { trees } = ctx.config;
  const out: Finding[] = [];
  for (const t of trees) {
    out.push(...checkIdentity(t));
    out.push(...checkLocalOverrides(t));
    out.push(...checkSigning(t));
    out.push(...checkRemotes(t));
    if (!ctx.offline) {
      out.push(...checkSsh(t));
      out.push(...checkReachable(t));
      out.push(...checkGhAccount(t));
      out.push(...checkGhOrgs(t, trees));
    }
  }
  out.push(...checkCollisions(trees));
  return out;
}
