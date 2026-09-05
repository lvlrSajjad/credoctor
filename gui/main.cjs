// Electron main process.
//
// It owns exactly one privileged capability: running the credkit CLI and handing its JSON
// to the renderer. The renderer has no Node access — see preload.cjs. Keeping the split
// this sharp means the GUI can never do something the CLI cannot, which is what makes the
// CLI the real product and this a viewer.
const { app, BrowserWindow, ipcMain, shell, nativeTheme } = require("electron");
const { execFile } = require("node:child_process");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const CLI = path.join(ROOT, "dist", "cli.js");

let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1000,
    height: 760,
    minWidth: 720,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#16181d" : "#f6f7f9",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.loadFile(path.join(__dirname, "index.html"));

  // External links open in the real browser, never inside the app window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
}

/**
 * Run `credkit doctor --json`.
 *
 * execFile, not exec: no shell, so nothing in the user's shell config can intercept the
 * call or reinterpret arguments. Same reason the CLI itself avoids shells.
 */
function runDoctor({ offline, configPath }) {
  const args = [CLI, "doctor", "--json"];
  if (offline) args.push("--offline");
  if (configPath) args.push("--config", configPath);
  return new Promise((resolve) => {
    execFile(process.execPath, args, { cwd: ROOT, timeout: 180_000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      // doctor exits 1 when checks fail — that is a result, not an error.
      if (stdout && stdout.trim().startsWith("{")) {
        try {
          return resolve({ ok: true, ...JSON.parse(stdout) });
        } catch (e) {
          return resolve({ ok: false, error: `could not parse doctor output: ${e.message}` });
        }
      }
      resolve({ ok: false, error: (stderr || err?.message || "doctor produced no output").trim() });
    });
  });
}

ipcMain.handle("credkit:doctor", (_e, opts) => runDoctor(opts ?? {}));
ipcMain.handle("credkit:openExternal", (_e, url) => {
  if (/^https?:\/\//.test(url)) shell.openExternal(url);
});

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
