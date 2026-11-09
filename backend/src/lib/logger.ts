/**
 * JSON logs, one object per line (docs/spec-system-logs.md): `debug` and `info` on stdout, `warn` and `error` on stderr, so a host
 * can flag errors. Nothing is written to a file or the database. While developing (NODE_ENV=development) a short coloured line is
 * printed instead of JSON; production and tests always get JSON.
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

const COLOUR: Record<LogLevel, string> = { debug: "\x1b[2m", info: "\x1b[32m", warn: "\x1b[33m", error: "\x1b[31m" };
const RESET = "\x1b[0m";

/** The development line: `09:14:02.113 ERROR http.error method=POST route=/api/v1/users status=500`, coloured by level. */
function pretty(entry: { ts: string; level: LogLevel; event: string } & Record<string, unknown>): string {
  const { ts, level, event, stack, ...rest } = entry;
  const parts = Object.entries(rest).map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`);
  const head = `${ts.slice(11, 23)} ${level.toUpperCase().padEnd(5)} ${event}${parts.length ? " " + parts.join(" ") : ""}`;
  return `${COLOUR[level]}${head}${RESET}${typeof stack === "string" ? `\n${stack}` : ""}`;
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
    if (process.env.NODE_ENV === "development") {
      try {
        line = pretty(entry);
      } catch {
        // keep the JSON line
      }
    }
    (ORDER[level] >= ORDER.warn ? process.stderr : process.stdout).write(`${line}\n`);
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
