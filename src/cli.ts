/**
 * CMC CLI: start / stop / status
 *
 *   npm run cmc:start
 *   npm run cmc:stop
 *   npm run cmc:status
 */

import { spawn } from "node:child_process";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { destroySession, readSession, SESSION_FILE } from "./session.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const PID_FILE = join(ROOT, ".cmc.pid");

async function cmdStart(): Promise<void> {
  if (existsSync(PID_FILE)) {
    try {
      const oldPid = Number((await readFile(PID_FILE, "utf8")).trim());
      try {
        process.kill(oldPid, 0);
        console.error(
          `CMC allaqachon ishlayapti (pid=${oldPid}). Avval: npm run cmc:stop`
        );
        process.exit(1);
      } catch {
        await unlink(PID_FILE).catch(() => {});
      }
    } catch {
      // ignore
    }
  }

  const tsxBin = join(ROOT, "node_modules", ".bin", "tsx");
  const entry = join(ROOT, "src", "index.ts");
  const cmd = existsSync(tsxBin) ? tsxBin : "npx";
  const args = existsSync(tsxBin) ? [entry] : ["tsx", entry];

  const child = spawn(cmd, args, {
    cwd: ROOT,
    detached: true,
    stdio: ["ignore", "ignore", "inherit"],
    env: { ...process.env },
  });

  if (!child.pid) {
    console.error("Server ishga tushmadi.");
    process.exit(1);
  }

  await writeFile(PID_FILE, String(child.pid), "utf8");
  child.unref();

  // Sessiyaning yozilishini biroz kutamiz
  await new Promise((r) => setTimeout(r, 800));
  const session = await readSession();

  console.error(`CMC ishga tushdi (pid=${child.pid}).`);
  if (session?.token) {
    console.error(`Sessiya token: ${session.token.slice(0, 12)}… (to‘liq .cmc-session.json da)`);
  }
  console.error(
    `Dashboard: http://127.0.0.1:${process.env.DASHBOARD_PORT || 3847}/dashboard`
  );
  console.error(`To‘xtatish: npm run cmc:stop`);
}

async function cmdStop(): Promise<void> {
  let pid: number | null = null;

  if (existsSync(PID_FILE)) {
    try {
      pid = Number((await readFile(PID_FILE, "utf8")).trim());
    } catch {
      // ignore
    }
  }

  if (!pid) {
    const session = await readSession();
    if (session?.pid) pid = session.pid;
  }

  if (!pid) {
    console.error("Ishlayotgan CMC topilmadi (pid yo‘q).");
    await destroySession();
    if (existsSync(PID_FILE)) await unlink(PID_FILE).catch(() => {});
    process.exit(0);
  }

  try {
    process.kill(pid, "SIGTERM");
    console.error(`SIGTERM yuborildi (pid=${pid}).`);
  } catch {
    console.error(`Jarayon topilmadi yoki allaqachon to‘xtagan (pid=${pid}).`);
  }

  // Biroz kutib, keyin tozalash
  await new Promise((r) => setTimeout(r, 500));
  await destroySession();
  if (existsSync(PID_FILE)) await unlink(PID_FILE).catch(() => {});
  console.error("CMC to‘xtatildi, token bekor qilindi.");
}

async function cmdStatus(): Promise<void> {
  const session = await readSession();
  let running = false;
  let pid: number | null = session?.pid ?? null;

  if (existsSync(PID_FILE)) {
    try {
      pid = Number((await readFile(PID_FILE, "utf8")).trim());
    } catch {
      // ignore
    }
  }

  if (pid) {
    try {
      process.kill(pid, 0);
      running = true;
    } catch {
      running = false;
    }
  }

  console.log(
    JSON.stringify(
      {
        running,
        pid: running ? pid : null,
        startedAt: session?.startedAt ?? null,
        lastActivityAt: session?.lastActivityAt ?? null,
        hasToken: Boolean(session?.token),
        tokenPreview: session?.token
          ? session.token.slice(0, 8) + "…"
          : null,
        sessionFile: SESSION_FILE,
      },
      null,
      2
    )
  );
}

const cmd = process.argv[2] || "status";

if (cmd === "start") {
  void cmdStart();
} else if (cmd === "stop") {
  void cmdStop();
} else if (cmd === "status") {
  void cmdStatus();
} else {
  console.error("Foydalanish: cmc start | stop | status");
  process.exit(1);
}
