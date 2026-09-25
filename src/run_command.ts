
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
import { resolve } from "node:path";
import { requiresConfirmation, getRiskLevel } from "./danger.js";
import { logCommand } from "./audit.js";
import { addPending } from "./pending.js";

const TIMEOUT_MS = 30_000;

export interface RunCommandInput {
  command: string;
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
  const base = requestedCwd ? resolve(requestedCwd) : process.cwd();
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
      reason: "confirmation_required",
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

    const child = spawn(input.command, {
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
          reason: "timeout",
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

      await logCommand({
        command: input.command,
        cwd,
        result: code === 0 ? "success" : "error",
        durationMs,
        riskLevel,
        confirmed: !!input.confirmed,
        exitCode: code,
      });

      resolvePromise({
        ok: code === 0,
        stdout,
        stderr,
        exitCode: code,
        durationMs,
        cwd,
        riskLevel,
      });
    });
  });
}
