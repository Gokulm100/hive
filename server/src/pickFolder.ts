import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** True when the API runs on a managed cloud host (no user desktop). */
export function isCloudHostedApi(): boolean {
  return Boolean(
    process.env.RENDER ||
      process.env.RAILWAY_ENVIRONMENT ||
      process.env.FLY_APP_NAME ||
      process.env.K_SERVICE ||
      process.env.HIVE_CLOUD === "1"
  );
}

export function localFolderPickAvailable(): boolean {
  if (isCloudHostedApi()) return false;
  if (process.env.HIVE_DISABLE_FOLDER_PICK === "1") return false;
  return (
    process.platform === "darwin" ||
    process.platform === "win32" ||
    process.platform === "linux"
  );
}

/**
 * Open a native folder dialog on this machine (the API process’s desktop).
 * Only useful when Hive API runs on the user’s computer (`npm run dev`).
 */
export async function pickLocalFolder(): Promise<string> {
  if (!localFolderPickAvailable()) {
    throw new Error(
      "Folder picker needs Hive API on your computer (`npm run dev`). Use a GitHub repo for cloud, or paste a path when the API is local."
    );
  }

  if (process.platform === "darwin") {
    const { stdout } = await execFileAsync("osascript", [
      "-e",
      'POSIX path of (choose folder with prompt "Choose a project folder for Hive")',
    ]);
    const path = stdout.trim().replace(/\/+$/, "");
    if (!path) throw new Error("No folder selected");
    return path;
  }

  if (process.platform === "win32") {
    const script = [
      "Add-Type -AssemblyName System.Windows.Forms",
      "$f = New-Object System.Windows.Forms.FolderBrowserDialog",
      '$f.Description = "Choose a project folder for Hive"',
      "$f.ShowNewFolderButton = $true",
      "if ($f.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { exit 1 }",
      "$f.SelectedPath",
    ].join("; ");
    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-Command", script],
      { windowsHide: false }
    );
    const path = stdout.trim();
    if (!path) throw new Error("No folder selected");
    return path;
  }

  // Linux: prefer zenity, then kdialog
  try {
    const { stdout } = await execFileAsync("zenity", [
      "--file-selection",
      "--directory",
      "--title=Choose a project folder for Hive",
    ]);
    const path = stdout.trim();
    if (!path) throw new Error("No folder selected");
    return path;
  } catch (zenityErr) {
    try {
      const { stdout } = await execFileAsync("kdialog", [
        "--getexistingdirectory",
        process.env.HOME || "/",
        "Choose a project folder for Hive",
      ]);
      const path = stdout.trim();
      if (!path) throw new Error("No folder selected");
      return path;
    } catch {
      throw new Error(
        zenityErr instanceof Error
          ? `Folder picker failed (${zenityErr.message}). Install zenity or kdialog, or paste the path.`
          : "Folder picker failed. Install zenity or kdialog, or paste the path."
      );
    }
  }
}
