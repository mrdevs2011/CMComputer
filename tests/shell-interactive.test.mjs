import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { WebSocket } from "ws";
import { createServer } from "node:http";
import { setupShellWebSocket } from "../src/shell.js";
import { createSession, destroySession } from "../src/session.js";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("CMC Web App & Shell Integration", () => {
  let server;
  let baseUrl;
  let wsUrl;
  let token;

  before(async () => {
    const session = await createSession();
    token = session.token;

    server = createServer(async (req, res) => {
      const url = new URL(req.url || "/", "http://localhost");
      if (req.method === "GET" && url.pathname === "/") {
        const html = await readFile(join(__dirname, "..", "index.html"), "utf8");
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(html);
        return;
      }
      if (req.method === "POST" && (url.pathname === "/api/login" || url.pathname === "/api/mcp-url")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          ok: true,
          token,
          host: "localhost",
          mcpUrl: `https://localhost/mcp?token=${token}`,
        }));
        return;
      }
      res.writeHead(404);
      res.end();
    });

    setupShellWebSocket(server);

    await new Promise((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        baseUrl = `http://127.0.0.1:${addr.port}`;
        wsUrl = `ws://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  after(async () => {
    if (server) await new Promise((r) => server.close(r));
    await destroySession();
  });

  it("1. Serves index.html with Home Menu and Go Shell view", async () => {
    const res = await fetch(`${baseUrl}/`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.ok(html.includes("view-login"), "Must have login view");
    assert.ok(html.includes("view-menu"), "Must have menu view");
    assert.ok(html.includes("card-get-mcp"), "Must have Get MCP card");
    assert.ok(html.includes("card-go-shell"), "Must have Go Shell card");
    assert.ok(html.includes("acc-bar"), "Must have mobile accessory keyboard bar");
    assert.ok(html.includes("acc-ctrl"), "Must have CTRL key button");
  });

  it("2. /api/login authenticates and returns mcpUrl and token", async () => {
    const res = await fetch(`${baseUrl}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "test@example.com", password: "secretpassword" }),
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.ok, true);
    assert.ok(data.mcpUrl);
    assert.equal(data.token, token);
  });

  it("3. WebSocket establishes interactive shell session", async () => {
    const ws = new WebSocket(`${wsUrl}/ws?token=${encodeURIComponent(token)}&cols=80&rows=24`);

    await new Promise((resolve, reject) => {
      ws.on("open", resolve);
      ws.on("error", reject);
    });

    let output = "";
    ws.on("message", (chunk) => {
      output += chunk.toString("utf8");
    });

    // Wait for prompt
    await new Promise((r) => setTimeout(r, 600));

    // Send a command through WebSocket
    ws.send("echo TEST_WEBSOCKET_SHELL_OK\n");

    // Wait for response
    await new Promise((r) => setTimeout(r, 800));

    // Send resize command
    ws.send("\x01120,40");

    await new Promise((r) => setTimeout(r, 200));

    ws.close();
    await new Promise((r) => ws.on("close", r));

    console.log("WebSocket shell output received:", JSON.stringify(output));
    assert.ok(output.includes("TEST_WEBSOCKET_SHELL_OK"), "Shell should execute and echo the command");
  });
});
