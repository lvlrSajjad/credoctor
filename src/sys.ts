import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, isAbsolute } from "node:path";

/** Expand a leading `~` to the user's home directory. */
export function expand(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return join(homedir(), p.slice(2));
  return p;
}

/** Render an absolute path back with `~` for display. */
export function tildify(p: string): string {
  const h = homedir();
  return p.startsWith(h) ? "~" + p.slice(h.length) : p;
}

export interface RunResult {
  ok: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Run a binary with NO shell.
 *
 * This is deliberate and load-bearing. A user's shell may define a function that shadows
 * the binary — a `gh()` wrapper that forces `GH_CONFIG_DIR` from `$PWD`, for instance.
 * Going through a shell would let that wrapper silently override the environment credkit
 * sets, and every reading would describe the shell's opinion rather than the store we
 * asked about. Diagnosing that mistake once was expensive; do not reintroduce it by
 * switching this to `shell: true`.
 */
export function run(
  bin: string,
  args: string[],
  opts: { cwd?: string; env?: Record<string, string>; timeoutMs?: number } = {},
): RunResult {
  const r = spawnSync(bin, args, {
    cwd: opts.cwd,
    // Start from the real environment, then apply only explicit overrides.
    env: { ...process.env, ...(opts.env ?? {}) },
    encoding: "utf8",
    shell: false,
    timeout: opts.timeoutMs ?? 20_000,
  });
  return {
    ok: r.status === 0,
    code: r.status,
    stdout: (r.stdout ?? "").trim(),
    stderr: (r.stderr ?? "").trim(),
  };
}

/** `git` with an explicit working directory. */
export function git(cwd: string, ...args: string[]): RunResult {
  return run("git", ["-C", cwd, ...args]);
}

/** Read one git config value as resolved for `cwd` (includes conditional includes). */
export function gitConfig(cwd: string, key: string): string | null {
  const r = git(cwd, "config", "--get", key);
  return r.ok && r.stdout ? r.stdout : null;
}

/** Read a repo's *local* config only — the layer that overrides `includeIf`. */
export function gitLocalConfig(cwd: string, key: string): string | null {
  const r = git(cwd, "config", "--local", "--get", key);
  return r.ok && r.stdout ? r.stdout : null;
}

export function isGitRepo(dir: string): boolean {
  return existsSync(join(dir, ".git"));
}

export function which(bin: string): string | null {
  const r = run("/usr/bin/which", [bin]);
  return r.ok && r.stdout ? r.stdout.split("\n")[0] : null;
}

export function abs(p: string): string {
  const e = expand(p);
  return isAbsolute(e) ? e : join(process.cwd(), e);
}
