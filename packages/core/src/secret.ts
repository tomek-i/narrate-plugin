import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";

/** `sk_…d286`: enough to tell keys apart without revealing them. */
export function maskKey(key: string): string {
  return key.length <= 8 ? "…" : `${key.slice(0, 3)}…${key.slice(-4)}`;
}

/** Read the OS clipboard (Windows / macOS / Linux with wl-paste, xclip or xsel). */
export function readClipboard(): string {
  const candidates: [string, string[]][] =
    process.platform === "win32"
      ? [["powershell.exe", ["-NoProfile", "-Command", "Get-Clipboard -Raw"]]]
      : process.platform === "darwin"
        ? [["pbpaste", []]]
        : [
            ["wl-paste", ["--no-newline"]],
            ["xclip", ["-selection", "clipboard", "-o"]],
            ["xsel", ["--clipboard", "--output"]],
          ];
  for (const [cmd, args] of candidates) {
    try {
      return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    } catch {
      // try the next tool
    }
  }
  throw new Error("Couldn't read the clipboard (on Linux install wl-paste, xclip or xsel).");
}

/** Prompt on the terminal without echoing what's typed. */
function promptHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const out = rl as unknown as { _writeToOutput: (s: string) => void };
    let prompted = false;
    out._writeToOutput = (s) => {
      // Let the question through once, then swallow the echoed keystrokes.
      if (!prompted) {
        prompted = true;
        process.stdout.write(s);
      }
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
  });
}

/**
 * Get an API key without it appearing on the command line (and so in shell
 * history or a Claude Code transcript): from the clipboard, a hidden terminal
 * prompt, or piped stdin.
 */
export async function readSecret(o: { clipboard?: boolean; label: string }): Promise<string> {
  let key: string;
  if (o.clipboard) key = readClipboard();
  else if (process.stdin.isTTY) key = await promptHidden(`${o.label}: `);
  else {
    try {
      key = readFileSync(0, "utf8");
    } catch {
      key = "";
    }
  }
  key = key.trim();
  if (!key) {
    throw new Error(
      o.clipboard
        ? "The clipboard is empty: copy the key first."
        : "No key given. Copy it and re-run with --clipboard, or pipe it on stdin.",
    );
  }
  if (/\s/.test(key)) {
    throw new Error("That doesn't look like an API key (it contains whitespace).");
  }
  return key;
}
