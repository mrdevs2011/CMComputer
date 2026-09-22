/**
 * Sessiya tokeni va idle timeout.
 *
 * 1. Har start da yangi ACCESS_TOKEN generatsiya qilinadi (bir martalik).
 * 2. Token .cmc-session.json ga yoziladi; stop da o‘chiriladi / bekor qilinadi.
 * 3. 2 soat faolsiz (idle) qolsa avtomatik to‘xtaydi.
 */

import { randomBytes } from "node:crypto";
import { writeFile, readFile, unlink, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const SESSION_FILE = join(ROOT, ".cmc-session.json");

/** Idle timeout: 2 soat (ms). Env orqali o‘zgartirish mumkin. */
const IDLE_TIMEOUT_MS =
  Number(process.env.CMC_IDLE_TIMEOUT_MS) || 2 * 60 * 60 * 1000;

export interface SessionInfo {
  token: string;
  pid: number;
  startedAt: string;
  lastActivityAt: string;
}

let current: SessionInfo | null = null;
let idleTimer: ReturnType<typeof setInterval> | null = null;
let onIdleShutdown: (() => void) | null = null;

function generateToken(): string {
  return randomBytes(32).toString("hex");
}

/**
 * Yangi sessiya yaratadi, eski faylni ustidan yozadi.
 * Eski token avtomatik ishlamay qoladi (faylda faqat yangisi saqlanadi).
 */
export async function createSession(): Promise<SessionInfo> {
  const now = new Date().toISOString();
  current = {
    token: generateToken(),
    pid: process.pid,
    startedAt: now,
    lastActivityAt: now,
  };

  await writeFile(SESSION_FILE, JSON.stringify(current, null, 2), "utf8");
  console.error(
    `[session] Yangi sessiya token yaratildi (pid=${current.pid}). ` +
      `Token faqat shu jarayon uchun amal qiladi.`
  );
  return current;
}

/**
 * Joriy sessiyani o‘qiydi (xotiradan yoki fayldan).
 */
export async function readSession(): Promise<SessionInfo | null> {
  if (current) return current;
  try {
    const raw = await readFile(SESSION_FILE, "utf8");
    return JSON.parse(raw) as SessionInfo;
  } catch {
    return null;
  }
}

export function getSessionToken(): string | null {
  return current?.token ?? null;
}

export function getSessionInfo(): SessionInfo | null {
  return current;
}

/**
 * Token to‘g‘riligini tekshiradi (dashboard yoki kelajakdagi HTTP transport uchun).
 */
export function validateToken(token: string | null | undefined): boolean {
  if (!token || !current) return false;
  // timing-safe emas, lekin local-only token uchun yetarli
  return token === current.token;
}

/**
 * Faollikni yangilaydi (idle timer qayta boshlanadi).
 */
export function touchActivity(): void {
  if (!current) return;
  current.lastActivityAt = new Date().toISOString();
  // Faylni har safar yozmaslik — faqat xotirada. Stop da baribir o‘chiriladi.
}

/**
 * Sessiyani bekor qiladi: faylni o‘chiradi, tokenni tozalaydi.
 */
export async function destroySession(): Promise<void> {
  current = null;
  if (idleTimer) {
    clearInterval(idleTimer);
    idleTimer = null;
  }
  try {
    if (existsSync(SESSION_FILE)) {
      await unlink(SESSION_FILE);
      console.error("[session] Sessiya bekor qilindi, token o‘chirildi.");
    }
  } catch {
    // ignore
  }
}

/**
 * Idle timeoutni yoqadi. timeoutMs o‘tgach onShutdown chaqiriladi.
 */
export function startIdleWatch(onShutdown: () => void): void {
  onIdleShutdown = onShutdown;
  if (idleTimer) clearInterval(idleTimer);

  idleTimer = setInterval(() => {
    if (!current) return;
    const last = new Date(current.lastActivityAt).getTime();
    const idle = Date.now() - last;
    if (idle >= IDLE_TIMEOUT_MS) {
      console.error(
        `[session] Idle timeout: ${Math.round(idle / 60000)} daqiqa faolsiz. Server to‘xtatilmoqda.`
      );
      if (onIdleShutdown) onIdleShutdown();
    }
  }, 60_000); // har daqiqa tekshir

  // Node jarayonini ushlab turmasin
  if (idleTimer.unref) idleTimer.unref();
}

export function getIdleTimeoutMs(): number {
  return IDLE_TIMEOUT_MS;
}

export { SESSION_FILE };
