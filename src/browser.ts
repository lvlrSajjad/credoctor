import { existsSync, readFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";

export interface ChromeProfile {
  /** Directory name, i.e. the value of --profile-directory ("Default", "Profile 1"). */
  dir: string;
  /** Display name the user gave it. */
  name: string;
  /** Signed-in account, when Chrome knows one. */
  account?: string;
}

/**
 * Where Chromium-family browsers keep profile data, per platform.
 *
 * Order matters: the first root that actually exists wins, so a machine with both Chrome
 * and Chromium resolves to Chrome. They all share the `Local State` format, which is why
 * one reader covers the whole family.
 */
function candidateRoots(): string[] {
  const home = homedir();
  switch (platform()) {
    case "darwin":
      return [
        join(home, "Library/Application Support/Google/Chrome"),
        join(home, "Library/Application Support/Chromium"),
        join(home, "Library/Application Support/Microsoft Edge"),
        join(home, "Library/Application Support/BraveSoftware/Brave-Browser"),
      ];
    case "win32": {
      const local = process.env.LOCALAPPDATA ?? join(home, "AppData/Local");
      return [
        join(local, "Google/Chrome/User Data"),
        join(local, "Chromium/User Data"),
        join(local, "Microsoft/Edge/User Data"),
        join(local, "BraveSoftware/Brave-Browser/User Data"),
      ];
    }
    default: {
      // Linux and the BSDs. XDG_CONFIG_HOME wins when set; snap and flatpak relocate the
      // whole tree, so both are checked rather than assumed absent.
      const cfg = process.env.XDG_CONFIG_HOME ?? join(home, ".config");
      return [
        join(cfg, "google-chrome"),
        join(cfg, "chromium"),
        join(cfg, "microsoft-edge"),
        join(cfg, "BraveSoftware/Brave-Browser"),
        join(home, "snap/chromium/common/chromium"),
        join(home, ".var/app/com.google.Chrome/config/google-chrome"),
        join(home, ".var/app/org.chromium.Chromium/config/chromium"),
      ];
    }
  }
}

/** The browser data directory in use on this machine, or null if none is installed. */
export function chromeRoot(): string | null {
  return candidateRoots().find((p) => existsSync(join(p, "Local State"))) ?? null;
}

export function chromeInstalled(root: string | null = chromeRoot()): boolean {
  return root !== null;
}

/**
 * Read the profile list from `Local State`.
 *
 * Chrome writes this on exit and on profile changes, so it can lag a running browser
 * slightly — authoritative about which profiles exist, merely recent about which account
 * each is signed in as.
 */
export function listChromeProfiles(root: string | null = chromeRoot()): ChromeProfile[] {
  if (!root) return [];
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

export function chromeProfileDirExists(dir: string, root: string | null = chromeRoot()): boolean {
  return root !== null && existsSync(join(root, dir));
}
