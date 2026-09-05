#!/usr/bin/env node
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { loadConfig, importFromMachine, writeConfig } from "./config.js";
import { runChecks } from "./checks.js";
import { Finding } from "./types.js";
import { expand, tildify } from "./sys.js";

const DEFAULT_PATHS = ["./credoctor.json", join(homedir(), ".config/credoctor/config.json")];

const COLOR = process.stdout.isTTY && !process.env.NO_COLOR;
const ESC = "\u001b";
const c = (code: string, s: string) => (COLOR ? `${ESC}[${code}m${s}${ESC}[0m` : s);
const MARK: Record<Finding["status"], string> = {
  pass: c("32", "pass"),
  fail: c("31", "FAIL"),
  warn: c("33", "warn"),
  skip: c("90", "skip"),
};

function resolveConfigPath(explicit?: string): string | null {
  if (explicit) return existsSync(expand(explicit)) ? expand(explicit) : null;
  for (const p of DEFAULT_PATHS) if (existsSync(expand(p))) return expand(p);
  return null;
}

function usage(): void {
  console.log(`credoctor — verify your per-directory credential domains

  credoctor doctor [--config <path>] [--offline] [--json]
      Check every configured tree: git identity, local overrides, signing key,
      remote alias, SSH identity, real reachability, gh account and org access.
      Exits non-zero if anything fails.

  credoctor import [--write <path>]
      Draft a credoctor.json from the includeIf blocks already in ~/.gitconfig.

  --offline   skip every check that makes a network call
  --json      machine-readable output`);
}

function doctor(configPath: string | null, offline: boolean, json: boolean): number {
  if (!configPath) {
    console.error(`No config found. Looked in: ${DEFAULT_PATHS.join(", ")}`);
    console.error(`Run \`credoctor import\` to draft one from this machine.`);
    return 2;
  }
  const config = loadConfig(configPath);
  const findings = runChecks({ config, offline });

  if (json) {
    console.log(JSON.stringify({ config: tildify(configPath), offline, findings }, null, 2));
  } else {
    console.log(`credoctor doctor — ${config.trees.length} tree(s), config ${tildify(configPath)}${offline ? " (offline)" : ""}\n`);
    let current = "";
    for (const f of findings) {
      if (f.tree !== current) {
        current = f.tree;
        console.log(c("1", `  ${current}`));
      }
      console.log(`    ${MARK[f.status]}  ${f.check.padEnd(20)} ${f.detail}`);
      if (f.remedy) console.log(`          ${c("90", "→ " + f.remedy)}`);
    }
    const failed = findings.filter((f) => f.status === "fail").length;
    const warned = findings.filter((f) => f.status === "warn").length;
    console.log(
      `\n  ${findings.filter((f) => f.status === "pass").length} passed, ` +
        `${failed} failed, ${warned} warning(s), ${findings.filter((f) => f.status === "skip").length} skipped`,
    );
  }
  return findings.some((f) => f.status === "fail") ? 1 : 0;
}

function doImport(writePath?: string): number {
  const { config, ghStores, notes } = importFromMachine();
  if (!config.trees.length) {
    console.error("No includeIf blocks found in ~/.gitconfig — nothing to import.");
    console.error("credoctor assumes per-directory identities. See DESIGN.md for the shape it expects.");
    return 2;
  }
  if (writePath) {
    writeConfig(writePath, config);
    console.log(`Wrote ${config.trees.length} tree(s) to ${writePath}`);
  } else {
    console.log(JSON.stringify(config, null, 2));
  }
  if (ghStores.length) {
    console.error(`\ngh stores found (assign them to trees by hand — they live in shell config, not git):`);
    for (const s of ghStores) console.error(`  ${s}`);
  }
  for (const n of notes) console.error(`note: ${n}`);
  return 0;
}

function main(): void {
  const argv = process.argv.slice(2);
  // A leading flag means no command was given: `credoctor --offline` is the doctor with
  // a flag, not an attempt to run a command called "--offline".
  const cmd = argv[0]?.startsWith("-") ? undefined : argv[0];
  const flag = (name: string) => argv.includes(`--${name}`);
  const value = (name: string) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };

  if (flag("help") || cmd === "help") return usage();
  // Bare `credoctor` runs the doctor: it is the whole point of the tool, and making
  // people type `credoctor doctor` is a redundancy nobody thanks you for.
  if (!cmd) process.exit(doctor(resolveConfigPath(value("config")), flag("offline"), flag("json")));

  switch (cmd) {
    case "doctor":
      process.exit(doctor(resolveConfigPath(value("config")), flag("offline"), flag("json")));
      break;
    case "import":
      process.exit(doImport(value("write")));
      break;
    default:
      console.error(`Unknown command: ${cmd}\n`);
      usage();
      process.exit(2);
  }
}

main();
