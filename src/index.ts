/**
 * CMC MCP Server v2.3
 *
 * Tool: run_command + get_recent_commands
 * Local dashboard: http://127.0.0.1:3847/dashboard
 * Session: har start da yangi token, stop da bekor, idle 2h timeout
 *
 * Hech qanday fixed WORKDIR yoki sandbox yo'q.
 * Xavfli buyruqlar (dangerous / hard_write) uchun confirmed:true talab qilinadi.
 */

import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";
import { runCommand } from "./run_command.js";
import { getRecentCommands } from "./audit.js";
import { startDashboard } from "./dashboard.js";
import {
  createSession,
  destroySession,
  startIdleWatch,
  touchActivity,
  getIdleTimeoutMs,
  getSessionInfo,
} from "./session.js";

function createServer(): McpServer {
  const server = new McpServer({
    name: "cmc-mcp-server",
    version: "2.3.0",
  });

  server.registerTool(
    "run_command",
    {
      title: "Run Command",
      description:
        "Kompyuterda istalgan buyruqni bajaradi. " +
        "Hech qanday fixed WORKDIR yoki sandbox yo'q. " +
        "Xavfli buyruqlar (rm, dd, git push --force, shutdown va h.k.) " +
        "uchun confirmed:true talab qilinadi. " +
        "cwd berilmasa process.cwd() ishlatiladi. 30 soniya timeout. " +
        "Natija: stdout, stderr, exitCode, durationMs, riskLevel. " +
        "Xavfli buyruq bloklanganda pendingId qaytariladi — dashboard orqali ham tasdiqlash mumkin.",
      inputSchema: z.object({
        command: z
          .string()
          .min(1)
          .describe(
            "Bajariladigan buyruq. Masalan: 'git status', 'ls -la', " +
              "'mkdir -p ~/MR/NewProject && cd ~/MR/NewProject && git init', " +
              "'ngrok http 3000', 'vercel --prod'"
          ),
        cwd: z
          .string()
          .optional()
          .describe(
            "Ish papkasi (ixtiyoriy). Berilmasa process.cwd() ishlatiladi. " +
              "Mavjud bo'lishi shart — avval mkdir qilish mumkin."
          ),
        confirmed: z
          .boolean()
          .optional()
          .describe(
            "Xavfli buyruqni tasdiqlash. dangerous/hard_write darajasidagi " +
              "buyruqlar uchun true yuborilmasa buyruq bajarilmaydi."
          ),
      }),
    },
    async (args) => {
      touchActivity();
      const result = await runCommand({
        command: args.command,
        cwd: args.cwd,
        confirmed: args.confirmed,
      });

      if (result.needsConfirmation) {
        const pendingHint = result.pendingId
          ? `\nYoki dashboard orqali tasdiqlang (pendingId: ${result.pendingId}).`
          : "";
        return {
          content: [
            {
              type: "text" as const,
              text:
                `⚠️  XAVFLI BUYRUQ BLOKLANDI\n\n` +
                `Buyruq: ${args.command}\n` +
                `Daraja: ${result.riskLevel}\n` +
                (result.pendingId ? `pendingId: ${result.pendingId}\n` : "") +
                `\nDavom etish uchun confirmed: true bilan qayta chaqiring.` +
                pendingHint +
                `\n\nMisol:\n` +
                `run_command({\n` +
                `  command: "${args.command}",\n` +
                `  cwd: ${args.cwd ? `"${args.cwd}"` : "undefined"},\n` +
                `  confirmed: true\n` +
                `})`,
            },
          ],
          isError: true,
        };
      }

      const text = [
        `ok: ${result.ok}`,
        `exitCode: ${result.exitCode}`,
        `durationMs: ${result.durationMs}`,
        `cwd: ${result.cwd}`,
        `riskLevel: ${result.riskLevel ?? "unknown"}`,
        result.error ? `error: ${result.error}` : null,
        "----- stdout -----",
        result.stdout || "(bo'sh)",
        "----- stderr -----",
        result.stderr || "(bo'sh)",
      ]
        .filter(Boolean)
        .join("\n");

      return {
        content: [{ type: "text" as const, text }],
        isError: !result.ok,
      };
    }
  );

  server.registerTool(
    "get_recent_commands",
    {
      title: "Get Recent Commands",
      description:
        "Oxirgi bajarilgan run_command chaqiruvlarini logs/commands.log " +
        "fayldan o'qib qaytaradi (eng yangisi oxirida). " +
        "'Oxirgi nima qilding' kabi so'rovlar uchun ishlatiladi.",
      inputSchema: z.object({
        limit: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Nechta oxirgi yozuv qaytarilsin (default: 20)."),
      }),
    },
    async (args) => {
      touchActivity();
      const records = await getRecentCommands(args.limit ?? 20);

      if (records.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Hali hech qanday buyruq bajarilmagan (yoki log fayli topilmadi).",
            },
          ],
        };
      }

      const text = records
        .map((r, i) => {
          const lines = [
            `${i + 1}. [${r.ts}] ${r.command}`,
            `   cwd: ${r.cwd} | natija: ${r.result} | ${r.durationMs}ms`,
          ];
          if (r.riskLevel)
            lines.push(
              `   riskLevel: ${r.riskLevel}${r.confirmed ? " (confirmed)" : ""}`
            );
          if (r.exitCode !== undefined && r.exitCode !== null)
            lines.push(`   exitCode: ${r.exitCode}`);
          if (r.reason) lines.push(`   sabab: ${r.reason}`);
          if (r.error) lines.push(`   xato: ${r.error}`);
          return lines.join("\n");
        })
        .join("\n\n");

      return {
        content: [{ type: "text" as const, text }],
      };
    }
  );

  return server;
}

async function shutdown(reason: string): Promise<void> {
  console.error(`[cmc] To‘xtatilmoqda (${reason})...`);
  await destroySession();
  process.exit(0);
}

async function main(): Promise<void> {
  // 1. Yangi sessiya tokeni
  const session = await createSession();
  console.error(
    `[session] token=${session.token.slice(0, 12)}…  idle=${getIdleTimeoutMs() / 60000}min`
  );

  // 2. Signal handlers — cmc stop / Ctrl+C
  const onSignal = (sig: string) => {
    void shutdown(sig);
  };
  process.on("SIGINT", () => onSignal("SIGINT"));
  process.on("SIGTERM", () => onSignal("SIGTERM"));

  // 3. Idle timeout
  startIdleWatch(() => {
    void shutdown("idle-timeout");
  });

  // 4. Dashboard + MCP
  startDashboard();
  void serveStdio(createServer);
  console.error(
    "CMC MCP server v2.3 (run_command + confirmation + dashboard + session) ishga tushdi"
  );
}

void main();
