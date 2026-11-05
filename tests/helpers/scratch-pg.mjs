// A throwaway Postgres for tests that must run the real SQL (the workspace
// save). Starts a fresh cluster in a temp directory on a Unix socket only (no
// TCP port), and stops and removes it at the end. Needs the Postgres server
// binaries: PG_BIN, or /usr/lib/postgresql/<newest>/bin (installed on the CI
// runner image). As root (some containers), the server runs as `postgres`.
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function pgBin() {
  if (process.env.PG_BIN && existsSync(join(process.env.PG_BIN, "initdb"))) return process.env.PG_BIN;
  const base = "/usr/lib/postgresql";
  if (existsSync(base)) {
    const v = readdirSync(base).filter((d) => existsSync(join(base, d, "bin", "initdb"))).sort((x, y) => Number(y) - Number(x))[0];
    if (v) return join(base, v, "bin");
  }
  try {
    const dir = execFileSync("pg_config", ["--bindir"], { encoding: "utf8" }).trim();
    if (existsSync(join(dir, "initdb"))) return dir;
  } catch {
    /* fall through */
  }
  return null;
}

export function startScratchPg() {
  const bin = pgBin();
  if (!bin) throw new Error("No Postgres server binaries found (set PG_BIN). This test runs the real workspace SQL and cannot run without them.");
  const root = process.getuid?.() === 0;
  const dir = mkdtempSync(join(tmpdir(), "tbf-pg-"));
  chmodSync(dir, 0o777);
  const data = join(dir, "data");
  const as = (cmd, args, opts = {}) =>
    root
      ? execFileSync("runuser", ["-u", "postgres", "--", join(bin, cmd), ...args], { encoding: "utf8", ...opts })
      : execFileSync(join(bin, cmd), args, { encoding: "utf8", ...opts });
  as("initdb", ["-D", data, "-A", "trust", "-U", "postgres", "--no-sync"], { stdio: "pipe" });
  as("pg_ctl", ["-D", data, "-l", join(dir, "log"), "-w", "-o", `-c listen_addresses='' -k ${dir} -c fsync=off`, "start"], { stdio: "pipe" });
  const psql = (args, input) => {
    const r = spawnSync(root ? "runuser" : join(bin, "psql"), [...(root ? ["-u", "postgres", "--", join(bin, "psql")] : []), "-h", dir, "-U", "postgres", "-d", "postgres", "-X", "-q", "-v", "ON_ERROR_STOP=1", ...args], { encoding: "utf8", input });
    return { ok: r.status === 0, out: (r.stdout || "").trim(), err: (r.stderr || "").trim() };
  };
  return {
    /** Runs a SQL file; throws with the server's message on any error. */
    file(path) {
      const r = psql(["-f", path]);
      if (!r.ok) throw new Error(r.err);
    },
    /** Runs SQL with psql variables (-v name=value); returns { ok, out, err }. */
    sql(text, vars = {}) {
      const f = join(dir, "q" + Math.random().toString(36).slice(2) + ".sql");
      writeFileSync(f, text);
      chmodSync(f, 0o644);
      const v = Object.entries(vars).flatMap(([k, val]) => ["-v", `${k}=${val}`]);
      return psql(["-At", ...v, "-f", f]);
    },
    stop() {
      try {
        as("pg_ctl", ["-D", data, "-m", "immediate", "stop"], { stdio: "pipe" });
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  };
}
