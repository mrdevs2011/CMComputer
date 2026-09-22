/**
 * Audit-log moduli.
 *
 * Har bir run_command chaqiruvini logs/commands.log fayliga yozadi:
 *   ts, command, cwd, result (success/error), durationMs (+ qo'shimcha detallar)
 *
 * Fayl hajmi 5MB dan oshsa, eskisi logs/commands.log.1 ga arxivlanadi
 * va yangi bo'sh fayl boshlanadi.
 */

import {
  appendFile,
  mkdir,
  readFile,
  rename,
  stat,
} from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG_DIR = join(__dirname, "..", "logs");
const LOG_FILE = join(LOG_DIR, "commands.log");
const ARCHIVE_FILE = join(LOG_DIR, "commands.log.1");
const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5MB

export type AuditResult = "success" | "error";

export interface AuditEntry {
  command: string;
  cwd: string;
  result: AuditResult;
  durationMs: number;
  // Qo'shimcha, ixtiyoriy detallar (mavjud bo'lsa yoziladi):
  riskLevel?: string;
  confirmed?: boolean;
  exitCode?: number | null;
  reason?: string;
  error?: string;
}

export interface AuditRecord extends AuditEntry {
  ts: string;
}

/**
 * Fayl 5MB dan oshgan bo'lsa, uni .1 ga arxivlaydi.
 * Eski arxiv bo'lsa, ustidan yoziladi (faqat bitta arxiv saqlanadi).
 */
async function rotateIfNeeded(): Promise<void> {
  try {
    const info = await stat(LOG_FILE);
    if (info.size >= MAX_SIZE_BYTES) {
      await rename(LOG_FILE, ARCHIVE_FILE);
    }
  } catch {
    // Fayl mavjud emas — hali rotatsiya kerak emas.
  }
}

/**
 * Bitta buyruq natijasini logs/commands.log ga yozadi.
 * Asosiy ish oqimini to'xtatmasin — xato bo'lsa jimgina o'tkazib yuboriladi.
 */
export async function logCommand(entry: AuditEntry): Promise<void> {
  try {
    await mkdir(LOG_DIR, { recursive: true });
    await rotateIfNeeded();

    const record: AuditRecord = {
      ts: new Date().toISOString(),
      ...entry,
    };

    await appendFile(LOG_FILE, JSON.stringify(record) + "\n", "utf8");
  } catch {
    // Log yozib bo'lmasa ham asosiy buyruq bajarilishi to'xtamasin.
  }
}

/**
 * Oxirgi N ta yozuvni qaytaradi (eng yangisi oxirida).
 * Faqat joriy commands.log dan o'qiydi — arxivga qaramaydi.
 */
export async function getRecentCommands(limit = 20): Promise<AuditRecord[]> {
  const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 20;

  let raw: string;
  try {
    raw = await readFile(LOG_FILE, "utf8");
  } catch {
    return [];
  }

  const lines = raw.split("\n").filter((line) => line.trim().length > 0);
  const lastLines = lines.slice(-safeLimit);

  const records: AuditRecord[] = [];
  for (const line of lastLines) {
    try {
      records.push(JSON.parse(line) as AuditRecord);
    } catch {
      // Buzilgan qator bo'lsa, o'tkazib yuboriladi.
    }
  }

  return records;
}
