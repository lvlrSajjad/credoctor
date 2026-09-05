import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface ChromeProfile {
  /** Directory name, i.e. the value of --profile-directory ("Default", "Profile 1"). */
  dir: string;
  /** Display name the user gave it. */
  name: string;
  /** Signed-in account, when Chrome knows one. */
  account?: string;
}

const CHROME_ROOT = join(homedir(), "Library/Application Support/Google/Chrome");

/**
 * Read Chrome's profile list from `Local State`.
 *
 * Chrome writes this file on exit and on profile changes, so it can lag a running browser
 * slightly — it is authoritative about which profiles exist, and merely recent about which
 * account each is signed in as.
 */
export function listChromeProfiles(root = CHROME_ROOT): ChromeProfile[] {
  const localState = join(root, "Local State");
  if (!existsSync(localState)) return [];
  try {
    const cache = JSON.parse(readFileSync(localState, "utf8"))?.profile?.info_cache ?? {};
    return Object.entries(cache).map(([dir, v]) => ({
      dir,
      name: (v as { name?: string }).name ?? dir,
      account: (v as { user_name?: string }).user_name || undefined,
    }));
  } catch {
    return [];
  }
}

export function chromeProfileDirExists(dir: string, root = CHROME_ROOT): boolean {
  return existsSync(join(root, dir));
}

export function chromeInstalled(root = CHROME_ROOT): boolean {
  return existsSync(root);
}
