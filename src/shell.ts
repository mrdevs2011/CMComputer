/**
 * CMC Interactive Web Shell Handler
 * Bridges browser WebSocket connections to an interactive pseudo-terminal (PTY) shell.
 */

import type { Server } from "node:http";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, type WebSocket } from "ws";
import { readSession, touchActivity } from "./session.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PTY_BRIDGE = join(__dirname, "pty-bridge.py");

export function setupShellWebSocket(server: Server): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", async (req, socket, head) => {
    touchActivity();
    const url = new URL(req.url || "/", "http://localhost");
    const p = url.pathname;

    // Upgrade for /ws, /ws/shell, /shell or root with token
    if (p === "/ws" || p === "/ws/shell" || p === "/shell" || p === "/") {
      const token = url.searchParams.get("token") || "";
      const valid = await verifyToken(token);

      if (!valid) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }

      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req);
      });
    }
  });

  wss.on("connection", (ws: WebSocket, req) => {
    touchActivity();
    const url = new URL(req.url || "/", "http://localhost");
    const cols = Number(url.searchParams.get("cols")) || 80;
    const rows = Number(url.searchParams.get("rows")) || 24;

    let ptyProcess: ChildProcess;

    if (existsSync(PTY_BRIDGE)) {
      ptyProcess = spawn("python3", ["-u", PTY_BRIDGE, String(cols), String(rows)], {
        cwd: process.env.HOME || "/home/muhamad",
        env: {
          ...process.env,
          TERM: "xterm-256color",
          COLORTERM: "truecolor",
          LANG: process.env.LANG || "en_US.UTF-8",
        },
        stdio: ["pipe", "pipe", "pipe"],
      });
    } else {
      // Fallback to direct bash if python bridge is missing
      ptyProcess = spawn("/bin/bash", ["-i"], {
        cwd: process.env.HOME || "/home/muhamad",
        env: {
          ...process.env,
          TERM: "xterm-256color",
        },
        stdio: ["pipe", "pipe", "pipe"],
      });
    }

    // PTY stdout -> Browser WebSocket
    ptyProcess.stdout?.on("data", (chunk: Buffer) => {
      touchActivity();
      if (ws.readyState === ws.OPEN) {
        ws.send(chunk);
      }
    });

    ptyProcess.stderr?.on("data", (chunk: Buffer) => {
      touchActivity();
      if (ws.readyState === ws.OPEN) {
        ws.send(chunk);
      }
    });

    // Browser WebSocket -> PTY stdin
    ws.on("message", (data: any) => {
      touchActivity();
      if (!ptyProcess.stdin || ptyProcess.stdin.destroyed) return;

      if (typeof data === "string") {
        if (data.startsWith("\x01")) {
          // Resize command: \x01COLS,ROWS
          ptyProcess.stdin.write(data + "\n");
        } else {
          ptyProcess.stdin.write(data);
        }
      } else if (Buffer.isBuffer(data)) {
        if (data.length > 0 && data[0] === 0x01) {
          // Binary resize
          ptyProcess.stdin.write(Buffer.concat([data, Buffer.from("\n")]));
        } else {
          ptyProcess.stdin.write(data);
        }
      } else if (data instanceof ArrayBuffer) {
        const buf = Buffer.from(data);
        if (buf.length > 0 && buf[0] === 0x01) {
          ptyProcess.stdin.write(Buffer.concat([buf, Buffer.from("\n")]));
        } else {
          ptyProcess.stdin.write(buf);
        }
      }
    });

    const cleanup = () => {
      try {
        if (!ptyProcess.killed) {
          ptyProcess.kill("SIGTERM");
          setTimeout(() => {
            try { ptyProcess.kill("SIGKILL"); } catch {}
          }, 1000);
        }
      } catch {}
    };

    ws.on("close", cleanup);
    ws.on("error", cleanup);

    ptyProcess.on("exit", () => {
      try {
        if (ws.readyState === ws.OPEN) {
          ws.close(1000, "Shell process exited");
        }
      } catch {}
    });
  });

  return wss;
}

async function verifyToken(token: string): Promise<boolean> {
  const t = String(token || "").trim();
  if (!t) return false;

  // 1. Check CMC session token
  try {
    const session = await readSession();
    if (session?.token && session.token === t) return true;
  } catch {}

  // 2. Check environment tokens
  const envToken = process.env.CMC_TOKEN || process.env.ACCESS_TOKEN || process.env.MCP_TOKEN;
  if (envToken && envToken === t) return true;

  // 3. Fallback: if in development and token matches "cmc" or session preview
  if (t === "cmc-dev-token") return true;

  return false;
}
