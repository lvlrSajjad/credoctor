import { readdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { Config, Tree } from "./types.js";
import { expand, run, isGitRepo, tildify } from "./sys.js";

export function loadConfig(path: string): Config {
  const raw = readFileSync(expand(path), "utf8");
  const cfg = JSON.parse(raw) as Config;
  if (!Array.isArray(cfg.trees)) throw new Error("config: `trees` must be an array");
  for (const t of cfg.trees) {
    if (!t.path) throw new Error("config: every tree needs a `path`");
    if (!t.git?.email) throw new Error(`config: tree ${t.name ?? t.path} needs git.email`);
    if (!t.name) t.name = t.path.replace(/\/+$/, "").split("/").pop() ?? t.path;
  }
  return cfg;
}

/** Every directory one or two levels under `root` that is a git repo. */
export function findRepos(root: string, maxDepth = 3): string[] {
  const out: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth > maxDepth || !existsSync(dir)) return;
    if (isGitRepo(dir)) out.push(dir);
    let entries: string[] = [];
    try {
      entries = readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isDirectory() && !e.name.startsWith(".") && e.name !== "node_modules")
        .map((e) => e.name);
    } catch {
      return;
    }
    for (const e of entries) walk(join(dir, e), depth + 1);
  };
  walk(expand(root), 0);
  return out;
}

/**
 * Build a first-draft config from what is already on this machine.
 *
 * Reads the `includeIf` blocks in ~/.gitconfig — the convention this tool assumes people
 * already use — and the files they point at. SSH alias and orgs are inferred from the
 * remotes actually in use, which is evidence rather than guesswork. `gh` store and browser
 * profile cannot be inferred reliably (they live in shell functions and launcher scripts),
 * so they are left blank and the discovered stores are reported for you to assign.
 */
export function importFromMachine(): { config: Config; ghStores: string[]; notes: string[] } {
  const notes: string[] = [];
  const r = run("git", ["config", "--global", "--get-regexp", "^includeIf\\."]);
  const trees: Tree[] = [];

  for (const line of r.stdout.split("\n").filter(Boolean)) {
    // includeIf.gitdir:~/Coding/ET/.path /Users/me/.gitconfig-et
    // git normalises section names to lower case on read, so this must be
    // case-insensitive: the key comes back as `includeif.gitdir:...`.
    const m = line.match(/^includeif\.gitdir(?:\/i)?:(.+?)\.path\s+(.+)$/i);
    if (!m) continue;
    const treePath = m[1].replace(/\/$/, "");
    const includeFile = expand(m[2].trim());
    if (!existsSync(includeFile)) {
      notes.push(`include file missing for ${treePath}: ${m[2]}`);
      continue;
    }
    const cfgGet = (k: string) => {
      const g = run("git", ["config", "--file", includeFile, "--get", k]);
      return g.ok && g.stdout ? g.stdout : undefined;
    };
    const email = cfgGet("user.email");
    if (!email) {
      notes.push(`no user.email in ${m[2]} — skipped`);
      continue;
    }
    const name = treePath.replace(/\/+$/, "").split("/").pop() ?? treePath;
    const tree: Tree = {
      name,
      path: treePath,
      git: { name: cfgGet("user.name"), email },
      signingKey: cfgGet("user.signingkey"),
    };

    // Infer the SSH alias and orgs from the remotes actually configured.
    const aliases = new Set<string>();
    const orgs = new Set<string>();
    for (const repo of findRepos(treePath)) {
      const url = run("git", ["-C", repo, "ls-remote", "--get-url", "origin"]).stdout;
      const ssh = url.match(/^git@([^:]+):([^/]+)\//);
      if (ssh) {
        aliases.add(ssh[1]);
        orgs.add(ssh[2]);
        continue;
      }
      const https = url.match(/^https:\/\/[^/]*github\.com\/([^/]+)\//);
      if (https) orgs.add(https[1]);
    }
    if (aliases.size === 1) tree.sshAlias = [...aliases][0];
    else if (aliases.size > 1) notes.push(`${name}: several SSH aliases in use (${[...aliases].join(", ")}) — pick one`);
    if (orgs.size) tree.orgs = [...orgs];

    trees.push(tree);
  }

  // Report gh stores so they can be assigned by hand.
  const cfgRoot = join(homedir(), ".config");
  const ghStores: string[] = [];
  if (existsSync(cfgRoot)) {
    for (const e of readdirSync(cfgRoot)) {
      if (!/^gh(-.*)?$/.test(e)) continue;
      const hosts = join(cfgRoot, e, "hosts.yml");
      if (!existsSync(hosts)) continue;
      const user = readFileSync(hosts, "utf8").match(/^\s*user:\s*(\S+)/m)?.[1] ?? "?";
      ghStores.push(`${tildify(join(cfgRoot, e))} -> ${user}`);
    }
  }

  return { config: { trees }, ghStores, notes };
}

export function writeConfig(path: string, cfg: Config): void {
  writeFileSync(expand(path), JSON.stringify(cfg, null, 2) + "\n", "utf8");
}
