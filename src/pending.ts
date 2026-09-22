/**
 * Pending (tasdiq kutayotgan) xavfli buyruqlar store.
 * In-memory — server qayta ishga tushganda tozalanadi.
 */

import { randomUUID } from "node:crypto";

export interface PendingCommand {
  id: string;
  command: string;
  cwd: string;
  riskLevel: string;
  createdAt: string;
  status: "pending" | "approved" | "denied";
}

const pending = new Map<string, PendingCommand>();

export function addPending(command: string, cwd: string, riskLevel: string): PendingCommand {
  const entry: PendingCommand = {
    id: randomUUID(),
    command,
    cwd,
    riskLevel,
    createdAt: new Date().toISOString(),
    status: "pending",
  };
  pending.set(entry.id, entry);
  return entry;
}

export function getPending(id: string): PendingCommand | undefined {
  return pending.get(id);
}

export function listPending(): PendingCommand[] {
  return Array.from(pending.values())
    .filter((p) => p.status === "pending")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function setPendingStatus(
  id: string,
  status: "approved" | "denied"
): PendingCommand | undefined {
  const entry = pending.get(id);
  if (!entry || entry.status !== "pending") return undefined;
  entry.status = status;
  // Approved/denied yozuvlarni 5 daqiqadan keyin tozalash mumkin, lekin
  // hozircha saqlab turamiz (listPending faqat pendinglarni ko'rsatadi).
  return entry;
}

export function removePending(id: string): void {
  pending.delete(id);
}
