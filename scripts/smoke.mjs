/**
 * Cross-platform functional smoke test.
 *
 * Builds a throwaway tree with a real git repo, points a config at it, and asserts that
 * doctor reports what it should — both when the tree is correct and when it is not. Runs
 * offline so it needs no network and no credentials, which is what lets it run in CI on
 * Linux, macOS and Windows alike.
 *
 * Usage: node scripts/smoke.mjs
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const CLI = join(ROOT, "dist", "cli.js");

let failures = 0;
const check = (label, cond, extra = "") => {
  console.log(`${cond ? "  ok  " : "  FAIL"} ${label}${cond || !extra ? "" : `  (${extra})`}`);
  if (!cond) failures++;
};

const tmp = mkdtempSync(join(tmpdir(), "credkit-smoke-"));
const treeDir = join(tmp, "work");
const repoDir = join(treeDir, "example");
mkdirSync(repoDir, { recursive: true });

const git = (...args) => execFileSync("git", ["-C", repoDir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
git("init", "--quiet");
git("remote", "add", "origin", "git@github-work:acme/example.git");
git("config", "--local", "user.name", "Work Person");
git("config", "--local", "user.email", "person@work.example");

const configPath = join(tmp, "credkit.json");
const writeConfig = (email) =>
  writeFileSync(
    configPath,
    JSON.stringify({
      trees: [
        {
          name: "work",
          path: treeDir,
          git: { name: "Work Person", email },
          sshAlias: "github-work",
        },
      ],
    }),
  );

const doctor = () => {
  const r = spawnSync(process.execPath, [CLI, "doctor", "--offline", "--json", "--config", configPath], {
    encoding: "utf8",
    cwd: ROOT,
  });
  let json = null;
  try {
    json = JSON.parse(r.stdout);
  } catch {
    /* leave null; the assertions below will report it */
  }
  return { code: r.status, json, stderr: r.stderr };
};

console.log(`credkit smoke test  (node ${process.version}, ${process.platform})\n`);

// --- 1. A correct tree passes -------------------------------------------------------
writeConfig("person@work.example");
let res = doctor();
check("doctor emits valid JSON", res.json !== null, res.stderr.slice(0, 200));
const find = (c) => res.json?.findings.find((f) => f.check === c);
check("exit code 0 when nothing fails", res.code === 0, `got ${res.code}`);
check("identity resolves", find("identity")?.status === "pass", find("identity")?.detail);
check("no local override reported", find("no-local-override")?.status === "pass");
check("remote-alias satisfied by git@github-work:", find("remote-alias")?.status === "pass", find("remote-alias")?.detail);
check("offline run skips network checks", !res.json?.findings.some((f) => f.check === "ssh-identity" && f.status !== "skip"));
check("offline flag echoed", res.json?.offline === true);

// --- 2. A wrong identity fails, and says so ------------------------------------------
writeConfig("someone-else@other.example");
res = doctor();
check("exit code 1 when a check fails", res.code === 1, `got ${res.code}`);
const identity = res.json?.findings.find((f) => f.check === "identity");
check("identity failure detected", identity?.status === "fail", identity?.detail);
check("failure carries a remedy", Boolean(identity?.remedy));
const override = res.json?.findings.find((f) => f.check === "no-local-override");
check("local override detected", override?.status === "fail", override?.detail);

rmSync(tmp, { recursive: true, force: true });

console.log(`\n${failures === 0 ? "smoke test passed" : `${failures} assertion(s) failed`}`);
process.exit(failures === 0 ? 0 : 1);
