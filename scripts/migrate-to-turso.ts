/**
 * One-shot migration: copy local SQLite (data/crm.db) → Turso remote.
 *
 * Usage:
 *   1. Set in .env.local:
 *        TURSO_DATABASE_URL=libsql://<your-db>.turso.io
 *        TURSO_AUTH_TOKEN=<full-access-token>
 *   2. Run: pnpm db:migrate-to-turso
 *
 * Reads every table from the local file, recreates schema on remote, and
 * inserts rows in batches. Safe to re-run: TRUNCATEs the remote tables first
 * (uses DELETE; sqlite TRUNCATE doesn't exist).
 */
import { createClient } from "@libsql/client";
import fs from "node:fs";
import path from "node:path";

const remote = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN!,
});

const local = createClient({ url: "file:./data/crm.db" });

async function main() {
  if (!process.env.TURSO_DATABASE_URL || !process.env.TURSO_AUTH_TOKEN) {
    console.error("❌ Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN first");
    process.exit(1);
  }

  console.log("→ Applying schema to remote...");
  const schemaSql = fs.readFileSync(path.resolve("src/lib/schema.sql"), "utf8");
  const stmts = schemaSql
    .split(/;\s*\n/)
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith("--"));
  for (const s of stmts) {
    try {
      await remote.execute(s);
    } catch (e: any) {
      // PRAGMA statements aren't supported on remote — skip them quietly
      if (!s.toUpperCase().startsWith("PRAGMA")) {
        console.warn(`  ⚠️ skipping: ${s.slice(0, 60)}... (${e.message})`);
      }
    }
  }
  console.log("✅ schema applied");

  // Tables to copy in dependency order (no FK violations on insert)
  const tables = [
    "users",
    "companies",
    "contacts",
    "templates",
    "outreach_attempts",
    "replies",
    "deals",
    "kb_objections",
    "kb_reply_links",
    "agent_runs",
    "agent_events",
    "notifications",
    "audit_log",
    "existing_customers",
  ];

  for (const tbl of tables) {
    // Skip if local doesn't have it
    const exists = await local.execute({
      sql: "SELECT name FROM sqlite_master WHERE type='table' AND name = ?",
      args: [tbl],
    });
    if (exists.rows.length === 0) {
      console.log(`  -- ${tbl}: not in local, skipping`);
      continue;
    }

    // Clear remote table
    await remote.execute(`DELETE FROM ${tbl}`);

    // Read local rows
    const rows = (await local.execute(`SELECT * FROM ${tbl}`)).rows;
    if (rows.length === 0) {
      console.log(`  -- ${tbl}: 0 rows`);
      continue;
    }

    // Build insert based on first row's keys
    const cols = Object.keys(rows[0]);
    const colsList = cols.map((c) => `"${c}"`).join(", ");
    const placeholders = cols.map(() => "?").join(", ");
    const insertSql = `INSERT INTO ${tbl} (${colsList}) VALUES (${placeholders})`;

    // Batch in chunks of 100 (Turso batch limit is 1000 statements, stay safer)
    const CHUNK = 100;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const slice = rows.slice(i, i + CHUNK);
      await remote.batch(
        slice.map((r) => ({
          sql: insertSql,
          args: cols.map((c) => r[c] as any),
        })),
        "write"
      );
    }
    console.log(`  ✅ ${tbl}: ${rows.length} rows`);
  }

  console.log("\n✅ Migration complete.");
}

main().catch((e) => { console.error(e); process.exit(1); });
