/**
 * JSON logs on stdout, one object per line (docs/spec-system-logs.md). Nothing is written to a file or the database.
 *
 * Error text from libraries (Prisma, fetch) can echo values, so anything taken from an exception goes through `redact` first.
 * Request and response bodies, headers, cookies, passwords and message text are never passed to `log` at all.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const RESERVED = new Set(["ts", "level", "event"]);

/** Read on every call, so a test (or an operator restarting with a new value) sees the change. */
function threshold(): number {
  const wanted = (process.env.LOG_LEVEL ?? "info").toLowerCase();
  return ORDER[wanted as LogLevel] ?? ORDER.info;
}

/** Writes one line. Never throws: a logging problem must not change a response. */
export function log(level: LogLevel, event: string, fields: Record<string, unknown> = {}): void {
  try {
    if (ORDER[level] < threshold()) return;
    // A field named like one of our own keys is renamed, not allowed to overwrite it.
    const safe: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(fields)) safe[RESERVED.has(key) ? `field_${key}` : key] = value;
    const entry = { ts: new Date().toISOString(), level, event, ...safe };
    let line: string;
    try {
      line = JSON.stringify(entry, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
    } catch {
      // A circular value: keep the line and say what happened, rather than lose it.
      line = JSON.stringify({ ts: entry.ts, level, event, log_error: "fields could not be serialised" });
    }
    process.stdout.write(`${line}\n`);
  } catch {
    // Nowhere left to report to.
  }
}

const PATTERNS: [RegExp, string][] = [
  [/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, "[jwt]"],
  [/\bBearer\s+[^\s"',;]+/gi, "Bearer [redacted]"],
  [/\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}/g, "[hash]"],
  [/\b(?:gsk|sk|AIza)[-_A-Za-z0-9]{16,}/g, "[key]"],
  [/\b(api[_-]?key|access[_-]?token|token|key|secret|password)=[^&\s"']+/gi, "$1=[redacted]"],
  [/"(password|passwordHash|token|secret|api[_-]?key|authorization)"\s*:\s*"[^"]*"/gi, '"$1":"[redacted]"'],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]"],
];

/** Removes tokens, keys, hashes and email addresses from text taken from an error, then cuts it at `limit` characters. */
export function redact(text: string, limit = 2000): string {
  if (typeof text !== "string" || !text) return "";
  let out = text;
  for (const [pattern, replacement] of PATTERNS) out = out.replace(pattern, replacement);
  return out.length > limit ? `${out.slice(0, limit)}…[truncated]` : out;
}
