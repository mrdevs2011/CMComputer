
function safeParseArgv(command: string): string[] | null {
  const s = String(command || "").trim();
  if (!s) return null;
  if (/[|;&`$()<>]/.test(s) || s.includes("\n")) return null;
  const parts: string[] = [];
  let cur = "";
  let q: string | null = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === q) q = null; else cur += c; continue; }
    if (c === '"' || c === "'") { q = c; continue; }
    if (/\s/.test(c)) { if (cur) { parts.push(cur); cur = ""; } continue; }
    cur += c;
  }
  if (q) return null;
  if (cur) parts.push(cur);
  if (!parts.length || parts[0] === "eval" || parts[0] === "exec") return null;
  return parts;
}

/**
 * run_command – umumiy buyruq bajarish tooli
 *
 * Hech qanday fixed WORKDIR yoki sandbox yo'q.
 * Claude istalgan papkada ishlay oladi, yangi papka yaratishi,
 * boshqa papkalarga erkin o'tishi mumkin.
 *
 * Xavfli buyruqlar (dangerous / hard_write) uchun confirmed:true talab qilinadi.
 */

import { spawn } from "node:child_process";
import { access, constants } from "node:fs/promises";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { requiresConfirmation, getRiskLevel } from "./danger.js";
import { logCommand } from "./audit.js";
import { addPending } from "./pending.js";

const TIMEOUT_MS = 30_000;
const CWD_MARKER = "__CMC_FINAL_CWD__:";
const __dirname = dirname(fileURLToPath(import.meta.url));
const STATE_DIR = join(__dirname, "..", ".state");
const LAST_CWD_PATH = join(STATE_DIR, "last-cwd");

function getDefaultCwd(): string {
  try {
    if (existsSync(LAST_CWD_PATH)) {
      const last = readFileSync(LAST_CWD_PATH, "utf8").trim();
      if (last && existsSync(last)) return last;
    }
  } catch {
    // ignore
  }
  return process.env.HOME || "/home/muhamad";
}

function saveLastCwd(dir: string): void {
  try {
    if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
    if (dir && existsSync(dir)) writeFileSync(LAST_CWD_PATH, dir + "\n", "utf8");
  } catch {
    // ignore
  }
}

function extractFinalCwd(stdout: string, fallback: string): { cleanStdout: string; finalCwd: string } {
  if (!stdout) return { cleanStdout: stdout || "", finalCwd: fallback };
  const lines = stdout.split("\n");
  let finalCwd = fallback;
  const kept: string[] = [];
  for (const line of lines) {
    if (line.startsWith(CWD_MARKER)) {
      const got = line.slice(CWD_MARKER.length).trim();
      if (got) finalCwd = got;
    } else {
      kept.push(line);
    }
  }
  return { cleanStdout: kept.join("\n"), finalCwd };
}

export interface RunCommandInput {
  command: string;
  /** Nima uchun bu buyruq bajarilayapti — har chaqiruvda majburiy */
  reason: string;
  cwd?: string;
  confirmed?: boolean;
}

export interface RunCommandResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
  cwd: string;
  riskLevel?: string;
  needsConfirmation?: boolean;
  pendingId?: string;
  error?: string;
}

async function resolveCwd(requestedCwd?: string): Promise<string> {
  const base = requestedCwd ? resolve(requestedCwd) : getDefaultCwd();
  try {
    await access(base, constants.F_OK);
  } catch {
    throw new Error(`cwd mavjud emas: ${base}`);
  }
  return base;
}

/**
 * Asosiy bajarish funksiyasi.
 */
export async function runCommand(input: RunCommandInput): Promise<RunCommandResult> {
  const start = Date.now();
  const riskLevel = getRiskLevel(input.command);
  const needsConfirm = requiresConfirmation(input.command);

  // --- Tasdiqlash tekshiruvi ---
  if (needsConfirm && !input.confirmed) {
    const cwdForPending = input.cwd ?? process.cwd();
    const pending = addPending(input.command, cwdForPending, riskLevel);

    const msg =
      `Bu buyruq xavfli (${riskLevel}): "${input.command}". ` +
      `Davom etish uchun confirmed: true bilan qayta chaqiring ` +
      `(yoki dashboard orqali tasdiqlang: pendingId=${pending.id}).`;

    await logCommand({
      command: input.command,
      cwd: cwdForPending,
      result: "error",
      durationMs: Date.now() - start,
      riskLevel,
      reason: input.reason,
      error: "confirmation_required",
    });

    return {
      ok: false,
      stdout: "",
      stderr: msg,
      exitCode: null,
      durationMs: Date.now() - start,
      cwd: cwdForPending,
      riskLevel,
      needsConfirmation: true,
      pendingId: pending.id,
      error: msg,
    };
  }

  // --- cwd aniqlash ---
  let cwd: string;
  try {
    cwd = await resolveCwd(input.cwd);
  } catch (err) {
    const msg = (err as Error).message;
    await logCommand({
      command: input.command,
      cwd: input.cwd ?? process.cwd(),
      result: "error",
      durationMs: Date.now() - start,
      riskLevel,
      reason: input.reason,
      error: msg,
    });
    return {
      ok: false,
      stdout: "",
      stderr: msg,
      exitCode: null,
      durationMs: Date.now() - start,
      cwd: input.cwd ?? process.cwd(),
      riskLevel,
      error: msg,
    };
  }

  if (!input.command.trim()) {
    return {
      ok: false,
      stdout: "",
      stderr: "command bo'sh bo'lishi mumkin emas",
      exitCode: null,
      durationMs: Date.now() - start,
      cwd,
      riskLevel,
      error: "command bo'sh bo'lishi mumkin emas",
    };
  }

  // --- Buyruqni bajarish ---
  return new Promise<RunCommandResult>((resolvePromise) => {
    let stdout = "";
    let stderr = "";
    let killedByTimeout = false;

    const shellCmd = [
      "set +e",
      input.command,
      "__cmc_ec=$?",
      `printf '\\n${CWD_MARKER}%s\\n' "$(pwd)"`,
      "exit $__cmc_ec",
    ].join("\n");

    const child = spawn(shellCmd, {
      cwd,
      shell: true,
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    const timer = setTimeout(() => {
      killedByTimeout = true;
      child.kill("SIGKILL");
    }, TIMEOUT_MS);

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", async (err) => {
      clearTimeout(timer);
      const durationMs = Date.now() - start;
      const msg = err.message;
      await logCommand({
        command: input.command,
        cwd,
        result: "error",
        durationMs,
        riskLevel,
        confirmed: !!input.confirmed,
        reason: input.reason,
        error: msg,
      });
      resolvePromise({
        ok: false,
        stdout,
        stderr: msg,
        exitCode: null,
        durationMs,
        cwd,
        riskLevel,
        error: msg,
      });
    });

    child.on("close", async (code) => {
      clearTimeout(timer);
      const durationMs = Date.now() - start;

      if (killedByTimeout) {
        const msg = `Timeout: buyruq ${TIMEOUT_MS / 1000} soniyadan oshdi`;
        await logCommand({
          command: input.command,
          cwd,
          result: "error",
          durationMs,
          riskLevel,
          confirmed: !!input.confirmed,
          exitCode: code,
          reason: input.reason,
          error: "timeout",
        });
        resolvePromise({
          ok: false,
          stdout,
          stderr: stderr ? stderr + "\n" + msg : msg,
          exitCode: code,
          durationMs,
          cwd,
          riskLevel,
          error: msg,
        });
        return;
      }

      const extracted = extractFinalCwd(stdout, cwd);
      stdout = extracted.cleanStdout;
      const finalCwd = extracted.finalCwd;
      saveLastCwd(finalCwd);

      await logCommand({
        command: input.command,
        cwd: finalCwd,
        result: code === 0 ? "success" : "error",
        durationMs,
        riskLevel,
        confirmed: !!input.confirmed,
        exitCode: code,
        reason: input.reason,
      });

      resolvePromise({
        ok: code === 0,
        stdout,
        stderr,
        exitCode: code,
        durationMs,
        cwd: finalCwd,
        riskLevel,
      });
    });
  });
}
