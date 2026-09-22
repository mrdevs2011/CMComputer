# CMC MCP Server v2.3

Claude MCP Computer — `run_command` + xavfli buyruqlar tasdiqlash + local dashboard + **sessiya tokenlari**.

## Asosiy qoidalar

> Hech qanday fixed WORKDIR yoki sandbox yo‘q.  
> Claude istalgan papkada ishlay oladi.  
> **Xavfli buyruqlar** (dangerous / hard_write) uchun `confirmed: true` talab qilinadi.

## Tool: run_command

```json
{
  "command": "string (majburiy)",
  "cwd": "string (ixtiyoriy)",
  "confirmed": "boolean (ixtiyoriy)"
}
```

### Xavf darajalari

| Daraja | confirmed kerakmi? | Misollar |
|--------|--------------------|----------|
| `dangerous` | **Ha** | `rm -rf /`, `dd if=...`, `git push --force`, `shutdown` |
| `hard_write` | **Ha** | `git push`, `npm install -g`, `systemctl restart`, `vercel --prod` |
| `write` | Yo‘q | `echo > file`, `mkdir`, `git add`, `git commit` |
| `read_safe` | Yo‘q | `ls`, `cat`, `git status`, `ps`, `df` |

Ro‘yxat: `danger-words.json`.

## Tool: get_recent_commands

```json
{ "limit": 20 }
```

## Bosqich 4 — Sessiya tokeni

Har `start` da yangi bir martalik token yaratiladi (`.cmc-session.json`).

| Buyruq | Nima qiladi |
|--------|-------------|
| `npm run cmc:start` | Yangi token + server fon rejimida |
| `npm run cmc:stop` | Serverni to‘xtatadi, tokenni bekor qiladi |
| `npm run cmc:status` | Holat (running, pid, token preview) |
| `npm start` | Foreground (Ctrl+C = stop + token bekor) |

**Idle timeout:** 2 soat hech qanday so‘rov (MCP tool yoki dashboard) kelmasa avtomatik to‘xtaydi.  
O‘zgartirish: `CMC_IDLE_TIMEOUT_MS=3600000` (1 soat).

```bash
npm run cmc:start
npm run cmc:status
npm run cmc:stop
```

> Eslatma: to‘liq WebSocket/PTY backend va brauzer terminali tokeni (`CMC_TOKEN`) alohida infratuzilmada. Shu repoda MCP + dashboard uchun local sessiya tokeni ishlaydi.

## Local Dashboard

```
http://127.0.0.1:3847/dashboard
```

- Server holati + sessiya token preview + idle limit  
- Tasdiq kutayotgan buyruqlar (Ruxsat / Rad)  
- Oxirgi buyruqlar  

Port: `DASHBOARD_PORT=4000 npm start`

## O‘rnatish

```bash
cd CMC
npm install
npm start          # yoki npm run cmc:start
```

## Claude sozlamasi

```json
{
  "mcpServers": {
    "cmc": {
      "command": "npx",
      "args": ["tsx", "/to'liq/yo'l/CMC/src/index.ts"]
    }
  }
}
```

## Misollar

```text
run_command({ command: "ls -la" })
run_command({ command: "rm -rf /tmp/test" })
→ bloklanadi + pendingId (dashboard yoki confirmed:true)
run_command({ command: "rm -rf /tmp/test", confirmed: true })
```

## Log

`logs/commands.log` — JSON satrlar. 5 MB → `commands.log.1`.
