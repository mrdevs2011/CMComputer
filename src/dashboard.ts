/**
 * Local web dashboard for CMC.
 * Port: process.env.DASHBOARD_PORT || 3847
 * Routes:
 *   GET  /dashboard          — HTML panel
 *   GET  /api/status         — server status + start time
 *   GET  /api/commands?limit — recent commands
 *   GET  /api/pending        — pending confirmation list
 *   POST /api/pending/:id/approve — approve & run command
 *   POST /api/pending/:id/deny    — deny pending command
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { getRecentCommands } from "./audit.js";
import { listPending, getPending, setPendingStatus, removePending } from "./pending.js";
import { runCommand } from "./run_command.js";
import { touchActivity, getSessionInfo, getIdleTimeoutMs } from "./session.js";

const PORT = Number(process.env.DASHBOARD_PORT) || 3847;
const STARTED_AT = new Date().toISOString();

function json(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store",
  });
  res.end(data);
}

function html(res: ServerResponse, body: string): void {
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function dashboardHtml(): string {
  return `<!doctype html>
<html lang="uz">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>CMC Dashboard</title>
<style>
  :root {
    --bg: #0d0e14;
    --card: #161b22;
    --border: #30363d;
    --text: #e6edf3;
    --muted: #8b949e;
    --green: #3fb950;
    --red: #f85149;
    --yellow: #d29922;
    --blue: #58a6ff;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 0;
    font-family: "JetBrains Mono", Menlo, Consolas, monospace;
    background: var(--bg); color: var(--text);
    min-height: 100vh;
  }
  header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 16px 24px; border-bottom: 1px solid var(--border);
    background: var(--card);
  }
  header h1 { margin: 0; font-size: 18px; font-weight: 600; }
  header h1 span { color: var(--green); }
  .status-pill {
    display: inline-flex; align-items: center; gap: 8px;
    padding: 6px 12px; border-radius: 999px;
    font-size: 12px; border: 1px solid var(--border);
  }
  .status-pill .dot {
    width: 8px; height: 8px; border-radius: 50%;
    background: var(--green); box-shadow: 0 0 6px var(--green);
  }
  .status-pill.off .dot { background: var(--red); box-shadow: 0 0 6px var(--red); }
  main { padding: 24px; max-width: 960px; margin: 0 auto; }
  section { margin-bottom: 28px; }
  section h2 {
    margin: 0 0 12px; font-size: 14px; color: var(--muted);
    text-transform: uppercase; letter-spacing: 0.06em;
  }
  .card {
    background: var(--card); border: 1px solid var(--border);
    border-radius: 10px; padding: 16px; overflow: hidden;
  }
  .meta { font-size: 12px; color: var(--muted); margin-bottom: 12px; }
  .empty { color: var(--muted); font-size: 13px; padding: 8px 0; }
  .cmd-list { list-style: none; margin: 0; padding: 0; }
  .cmd-item {
    padding: 12px 0; border-bottom: 1px solid var(--border);
    font-size: 13px;
  }
  .cmd-item:last-child { border-bottom: none; }
  .cmd-line { word-break: break-all; }
  .cmd-line code {
    background: #0d1117; padding: 2px 6px; border-radius: 4px;
    color: var(--blue);
  }
  .cmd-meta {
    margin-top: 6px; font-size: 11px; color: var(--muted);
    display: flex; flex-wrap: wrap; gap: 10px;
  }
  .badge {
    display: inline-block; padding: 2px 8px; border-radius: 4px;
    font-size: 11px; font-weight: 600;
  }
  .badge.success { background: rgba(63,185,80,0.15); color: var(--green); }
  .badge.error { background: rgba(248,81,73,0.15); color: var(--red); }
  .badge.pending { background: rgba(210,153,34,0.15); color: var(--yellow); }
  .badge.dangerous { background: rgba(248,81,73,0.2); color: var(--red); }
  .badge.hard_write { background: rgba(210,153,34,0.2); color: var(--yellow); }
  .actions { margin-top: 10px; display: flex; gap: 8px; }
  button {
    font: 12px monospace; border: none; border-radius: 6px;
    padding: 8px 14px; cursor: pointer;
  }
  button.approve { background: var(--green); color: #0d0e14; }
  button.approve:hover { filter: brightness(1.1); }
  button.deny { background: transparent; color: var(--red); border: 1px solid var(--red); }
  button.deny:hover { background: rgba(248,81,73,0.1); }
  button:disabled { opacity: 0.5; cursor: default; }
  .refresh {
    background: transparent; color: var(--muted);
    border: 1px solid var(--border); padding: 6px 12px;
  }
  .refresh:hover { color: var(--text); border-color: var(--muted); }
  footer {
    text-align: center; padding: 16px; font-size: 11px; color: var(--muted);
  }
</style>
</head>
<body>
<header>
  <h1><span>CMC</span> Dashboard</h1>
  <div style="display:flex;align-items:center;gap:12px">
    <div id="statusPill" class="status-pill">
      <span class="dot"></span>
      <span id="statusText">...</span>
    </div>
    <button class="refresh" id="refreshBtn" title="Yangilash">↻</button>
  </div>
</header>
<main>
  <section>
    <h2>Server holati</h2>
    <div class="card">
      <div class="meta" id="serverMeta">Yuklanmoqda...</div>
    </div>
  </section>

  <section>
    <h2>Tasdiq kutayotgan buyruqlar</h2>
    <div class="card">
      <ul class="cmd-list" id="pendingList">
        <li class="empty">Yuklanmoqda...</li>
      </ul>
    </div>
  </section>

  <section>
    <h2>Oxirgi buyruqlar</h2>
    <div class="card">
      <ul class="cmd-list" id="cmdList">
        <li class="empty">Yuklanmoqda...</li>
      </ul>
    </div>
  </section>
</main>
<footer>CMC local dashboard · faqat localhost</footer>
<script>
(function () {
  const statusPill = document.getElementById("statusPill");
  const statusText = document.getElementById("statusText");
  const serverMeta = document.getElementById("serverMeta");
  const pendingList = document.getElementById("pendingList");
  const cmdList = document.getElementById("cmdList");
  const refreshBtn = document.getElementById("refreshBtn");

  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function riskBadge(level) {
    if (!level) return "";
    const cls = level === "dangerous" || level === "hard_write" ? level : "";
    return '<span class="badge ' + cls + '">' + esc(level) + "</span>";
  }

  function resultBadge(r) {
    const cls = r === "success" ? "success" : "error";
    return '<span class="badge ' + cls + '">' + esc(r) + "</span>";
  }

  async function loadStatus() {
    try {
      const res = await fetch("/api/status");
      const data = await res.json();
      statusPill.classList.remove("off");
      statusText.textContent = "ON";
      const started = data.startedAt ? new Date(data.startedAt).toLocaleString() : "—";
      let sessionLine = "";
      if (data.session) {
        const last = data.session.lastActivityAt
          ? new Date(data.session.lastActivityAt).toLocaleString()
          : "—";
        sessionLine =
          "<br>Sessiya: " + esc(data.session.tokenPreview || "—") +
          " · Oxirgi faollik: " + esc(last) +
          " · Idle limit: " + esc(data.session.idleTimeoutMin) + " min";
      }
      serverMeta.innerHTML =
        "Holat: <strong style=\"color:var(--green)\">ON</strong> · " +
        "Ishga tushgan: " + esc(started) + " · " +
        "Port: " + esc(data.port) + sessionLine;
    } catch (e) {
      statusPill.classList.add("off");
      statusText.textContent = "OFF";
      serverMeta.textContent = "Serverga ulanish imkonsiz.";
    }
  }

  async function loadPending() {
    try {
      const res = await fetch("/api/pending");
      const data = await res.json();
      const items = data.pending || [];
      if (items.length === 0) {
        pendingList.innerHTML = '<li class="empty">Tasdiq kutayotgan buyruq yo\\'q.</li>';
        return;
      }
      pendingList.innerHTML = items.map(function (p) {
        return (
          '<li class="cmd-item" data-id="' + esc(p.id) + '">' +
            '<div class="cmd-line"><code>' + esc(p.command) + "</code></div>" +
            '<div class="cmd-meta">' +
              riskBadge(p.riskLevel) +
              "<span>cwd: " + esc(p.cwd) + "</span>" +
              "<span>" + esc(new Date(p.createdAt).toLocaleString()) + "</span>" +
            "</div>" +
            '<div class="actions">' +
              '<button class="approve" data-action="approve">Ruxsat berish</button>' +
              '<button class="deny" data-action="deny">Rad etish</button>' +
            "</div>" +
          "</li>"
        );
      }).join("");
    } catch (e) {
      pendingList.innerHTML = '<li class="empty">Xato: ' + esc(e.message) + "</li>";
    }
  }

  async function loadCommands() {
    try {
      const res = await fetch("/api/commands?limit=30");
      const data = await res.json();
      const items = data.commands || [];
      if (items.length === 0) {
        cmdList.innerHTML = '<li class="empty">Hali buyruq bajarilmagan.</li>';
        return;
      }
      // eng yangisi yuqorida
      const ordered = items.slice().reverse();
      cmdList.innerHTML = ordered.map(function (r) {
        return (
          '<li class="cmd-item">' +
            '<div class="cmd-line"><code>' + esc(r.command) + "</code></div>" +
            '<div class="cmd-meta">' +
              resultBadge(r.result) +
              (r.riskLevel ? riskBadge(r.riskLevel) : "") +
              "<span>" + esc(r.durationMs) + "ms</span>" +
              "<span>cwd: " + esc(r.cwd) + "</span>" +
              "<span>" + esc(new Date(r.ts).toLocaleString()) + "</span>" +
              (r.reason ? "<span>" + esc(r.reason) + "</span>" : "") +
            "</div>" +
          "</li>"
        );
      }).join("");
    } catch (e) {
      cmdList.innerHTML = '<li class="empty">Xato: ' + esc(e.message) + "</li>";
    }
  }

  async function act(id, action) {
    const btn = pendingList.querySelector('[data-id="' + id + '"]');
    if (btn) {
      btn.querySelectorAll("button").forEach(function (b) { b.disabled = true; });
    }
    try {
      const res = await fetch("/api/pending/" + encodeURIComponent(id) + "/" + action, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "Xato");
      }
    } catch (e) {
      alert(e.message);
    }
    await loadPending();
    await loadCommands();
  }

  pendingList.addEventListener("click", function (e) {
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;
    const action = t.getAttribute("data-action");
    if (!action) return;
    const item = t.closest("[data-id]");
    if (!item) return;
    const id = item.getAttribute("data-id");
    if (id) act(id, action);
  });

  async function refresh() {
    await Promise.all([loadStatus(), loadPending(), loadCommands()]);
  }

  refreshBtn.addEventListener("click", refresh);
  refresh();
  setInterval(refresh, 5000);
})();
</script>
</body>
</html>`;
}

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  touchActivity();
  const url = new URL(req.url || "/", `http://127.0.0.1:${PORT}`);
  const path = url.pathname;
  const method = (req.method || "GET").toUpperCase();

  // CORS preflight
  if (method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    res.end();
    return;
  }

  if (method === "GET" && (path === "/dashboard" || path === "/")) {
    html(res, dashboardHtml());
    return;
  }

  if (method === "GET" && path === "/api/status") {
    const session = getSessionInfo();
    json(res, 200, {
      status: "on",
      startedAt: STARTED_AT,
      port: PORT,
      uptimeMs: Date.now() - new Date(STARTED_AT).getTime(),
      session: session
        ? {
            startedAt: session.startedAt,
            lastActivityAt: session.lastActivityAt,
            hasToken: true,
            tokenPreview: session.token.slice(0, 8) + "…",
            idleTimeoutMin: getIdleTimeoutMs() / 60000,
          }
        : null,
    });
    return;
  }

  if (method === "GET" && path === "/api/commands") {
    const limit = Number(url.searchParams.get("limit")) || 20;
    const commands = await getRecentCommands(limit);
    json(res, 200, { commands });
    return;
  }

  if (method === "GET" && path === "/api/pending") {
    json(res, 200, { pending: listPending() });
    return;
  }

  // POST /api/pending/:id/approve | deny
  const pendingMatch = path.match(/^\/api\/pending\/([^/]+)\/(approve|deny)$/);
  if (method === "POST" && pendingMatch) {
    const id = decodeURIComponent(pendingMatch[1]);
    const action = pendingMatch[2] as "approve" | "deny";
    const entry = getPending(id);

    if (!entry || entry.status !== "pending") {
      json(res, 404, { error: "Pending buyruq topilmadi yoki allaqachon yopilgan." });
      return;
    }

    if (action === "deny") {
      setPendingStatus(id, "denied");
      removePending(id);
      json(res, 200, { ok: true, action: "denied", id });
      return;
    }

    // approve → confirmed:true bilan ishga tushirish
    setPendingStatus(id, "approved");
    try {
      const result = await runCommand({
        command: entry.command,
        cwd: entry.cwd,
        confirmed: true,
      });
      removePending(id);
      json(res, 200, {
        ok: result.ok,
        action: "approved",
        id,
        result: {
          exitCode: result.exitCode,
          durationMs: result.durationMs,
          stdout: result.stdout?.slice(0, 2000),
          stderr: result.stderr?.slice(0, 2000),
          error: result.error,
        },
      });
    } catch (err) {
      removePending(id);
      json(res, 500, {
        error: (err as Error).message,
        action: "approved",
        id,
      });
    }
    return;
  }

  json(res, 404, { error: "Not found" });
}

export function startDashboard(): void {
  const server = createServer((req, res) => {
    handleRequest(req, res).catch((err) => {
      console.error("[dashboard]", err);
      if (!res.headersSent) {
        json(res, 500, { error: "Internal error" });
      }
    });
  });

  server.listen(PORT, "127.0.0.1", () => {
    console.error(`CMC Dashboard: http://127.0.0.1:${PORT}/dashboard`);
  });

  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(`Dashboard port ${PORT} band — dashboard o‘chirib qo‘yildi.`);
    } else {
      console.error("[dashboard] error:", err.message);
    }
  });
}
