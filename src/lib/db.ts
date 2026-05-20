/**
 * Database access layer — uses @libsql/client so it works against:
 *   TURSO_DATABASE_URL=file:./data/crm.db        (local dev / scripts)
 *   TURSO_DATABASE_URL=libsql://<db>.turso.io    (Vercel production)
 *
 * The exported helpers keep the SQLite mental model but return Promises:
 *   const row  = await one<MyRow>("SELECT ... WHERE id = ?", [id]);
 *   const list = await all<MyRow>("SELECT ...", []);
 *   await run("UPDATE ... WHERE id = ?", [id]);
 */
import { createClient, type Client, type InValue } from "@libsql/client";
import fs from "node:fs";
import path from "node:path";

const url = process.env.TURSO_DATABASE_URL || "file:./data/crm.db";
const authToken = process.env.TURSO_AUTH_TOKEN;

let _db: Client | null = null;

export function getDb(): Client {
  if (_db) return _db;
  _db = createClient({ url, ...(authToken ? { authToken } : {}) });
  return _db;
}

export async function one<T = Record<string, unknown>>(
  sql: string,
  args: InValue[] = []
): Promise<T | undefined> {
  const r = await getDb().execute({ sql, args });
  return r.rows[0] as T | undefined;
}

export async function all<T = Record<string, unknown>>(
  sql: string,
  args: InValue[] = []
): Promise<T[]> {
  const r = await getDb().execute({ sql, args });
  return r.rows as unknown as T[];
}

export async function run(
  sql: string,
  args: InValue[] = []
): Promise<{ rowsAffected: number; lastInsertRowid: bigint | undefined }> {
  const r = await getDb().execute({ sql, args });
  return {
    rowsAffected: r.rowsAffected,
    lastInsertRowid: r.lastInsertRowid,
  };
}

/** Loads schema.sql into the connected DB. Idempotent. */
export async function applySchema(): Promise<void> {
  const sql = fs.readFileSync(
    path.resolve(process.cwd(), "src/lib/schema.sql"),
    "utf8"
  );
  // Split on ; but tolerate statements containing semicolons in strings? we don't have any.
  const stmts = sql
    .split(/;\s*\n/)
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith("--"));
  for (const s of stmts) await run(s);
}

/** Append-only audit row after a mutation. Call after the work is done. */
export async function audit(
  actor: string,
  entity: string,
  entityId: number | null,
  action: string,
  before: unknown,
  after: unknown
): Promise<void> {
  await run(
    `INSERT INTO audit_log (actor, entity, entity_id, action, diff_json)
     VALUES (?, ?, ?, ?, ?)`,
    [actor, entity, entityId, action, JSON.stringify({ before, after })]
  );
}
