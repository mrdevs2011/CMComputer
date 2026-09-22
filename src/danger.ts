/**
 * Xavfli buyruqlarni aniqlash moduli.
 * danger-words.json asosida ishlaydi.
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = join(__dirname, "..", "danger-words.json");

export type RiskLevel = "dangerous" | "hard_write" | "write" | "read_safe" | "unknown";

interface DangerConfig {
  dangerous: string[];
  hard_write: string[];
  write: string[];
  read_safe: string[];
  dangerous_patterns: string[];
  hard_write_patterns: string[];
}

let config: DangerConfig | null = null;
let compiledDangerous: RegExp[] = [];
let compiledHardWrite: RegExp[] = [];

function loadConfig(): DangerConfig {
  if (config) return config;
  try {
    const raw = readFileSync(CONFIG_PATH, "utf8");
    config = JSON.parse(raw) as DangerConfig;

    compiledDangerous = (config.dangerous_patterns || []).map((p) => {
      try {
        return new RegExp(p, "i");
      } catch {
        return null;
      }
    }).filter(Boolean) as RegExp[];

    compiledHardWrite = (config.hard_write_patterns || []).map((p) => {
      try {
        return new RegExp(p, "i");
      } catch {
        return null;
      }
    }).filter(Boolean) as RegExp[];

    return config;
  } catch (err) {
    console.error("danger-words.json yuklanmadi:", (err as Error).message);
    config = {
      dangerous: [],
      hard_write: [],
      write: [],
      read_safe: [],
      dangerous_patterns: [],
      hard_write_patterns: [],
    };
    return config;
  }
}

/**
 * Buyruqning xavf darajasini aniqlaydi.
 * Tartib: dangerous → hard_write → write → read_safe → unknown
 */
export function classifyCommand(command: string): RiskLevel {
  const cfg = loadConfig();
  const normalized = command.trim().toLowerCase();

  // 1. Exact match (dangerous)
  for (const item of cfg.dangerous) {
    if (normalized === item.toLowerCase() || normalized.includes(item.toLowerCase())) {
      // qisqa so'zlar uchun false-positive kamaytirish
      if (item.length < 4) continue;
      return "dangerous";
    }
  }

  // 2. Regex patterns (dangerous)
  for (const re of compiledDangerous) {
    if (re.test(command)) return "dangerous";
  }

  // 3. Exact match (hard_write)
  for (const item of cfg.hard_write) {
    if (normalized === item.toLowerCase() || normalized.includes(item.toLowerCase())) {
      if (item.length < 4) continue;
      return "hard_write";
    }
  }

  // 4. Regex patterns (hard_write)
  for (const re of compiledHardWrite) {
    if (re.test(command)) return "hard_write";
  }

  // 5. write
  for (const item of cfg.write) {
    if (normalized === item.toLowerCase() || normalized.startsWith(item.toLowerCase() + " ")) {
      return "write";
    }
  }

  // 6. read_safe
  for (const item of cfg.read_safe) {
    if (
      normalized === item.toLowerCase() ||
      normalized.startsWith(item.toLowerCase() + " ") ||
      normalized.startsWith(item.toLowerCase() + "\t")
    ) {
      return "read_safe";
    }
  }

  return "unknown";
}

/**
 * Buyruq confirmed:true talab qiladimi?
 * dangerous va hard_write → ha
 * qolganlari → yo'q
 */
export function requiresConfirmation(command: string): boolean {
  const level = classifyCommand(command);
  return level === "dangerous" || level === "hard_write";
}

export function getRiskLevel(command: string): RiskLevel {
  return classifyCommand(command);
}
