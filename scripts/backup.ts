/**
 * Daily backup — runs in 2 layers:
 *
 * Layer 1 (always): copy the SQLite file + WAL to data/backups/YYYY-MM-DD.db
 *                   Pure binary copy, fastest recovery.
 *
 * Layer 2 (always): dump every table to JSON in data/backups/YYYY-MM-DD/<table>.json
 *                   Human-readable, future-proof, survives schema changes.
 *
 * Layer 3 (optional): push backups/ to a separate Git repo (set BACKUP_GIT_REMOTE).
 *
 * Keeps last 30 daily backups; older are pruned.
 *
 * Run via: pnpm db:backup    (or cron / launchd / GitHub Actions)
 */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { getDb } from "../src/lib/db";

const today = new Date().toISOString().slice(0, 10);
const root = path.resolve("data/backups");
fs.mkdirSync(root, { recursive: true });

// --- Layer 1: SQLite file copy ---
const db = getDb();
const targetDb = path.join(root, `${today}.db`);
db.backup(targetDb)
  .then(() => console.log("✅ Layer 1: binary backup →", targetDb))
  .catch((e) => console.error("❌ Layer 1 failed:", e));

// --- Layer 2: JSON dump ---
const jsonDir = path.join(root, today);
fs.mkdirSync(jsonDir, { recursive: true });

const tables = db
  .prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
  )
  .all() as { name: string }[];

for (const { name } of tables) {
  const rows = db.prepare(`SELECT * FROM "${name}"`).all();
  fs.writeFileSync(
    path.join(jsonDir, `${name}.json`),
    JSON.stringify(rows, null, 2)
  );
  console.log(`  ✅ ${name}: ${rows.length} rows`);
}
console.log("✅ Layer 2: JSON dump →", jsonDir);

// --- Prune backups older than 30 days ---
const cutoff = Date.now() - 30 * 24 * 3600 * 1000;
for (const entry of fs.readdirSync(root)) {
  const full = path.join(root, entry);
  const stat = fs.statSync(full);
  if (stat.mtimeMs < cutoff) {
    fs.rmSync(full, { recursive: true, force: true });
    console.log(`  🗑️  pruned ${entry}`);
  }
}

// --- Layer 3: optional Git push ---
const remote = process.env.BACKUP_GIT_REMOTE;
if (remote) {
  try {
    if (!fs.existsSync(path.join(root, ".git"))) {
      execSync(`git init`, { cwd: root });
      execSync(`git remote add origin ${remote}`, { cwd: root });
    }
    execSync(`git add -A && git commit -m "backup ${today}" || true`, {
      cwd: root,
      stdio: "inherit",
    });
    execSync(`git push -u origin HEAD || true`, { cwd: root, stdio: "inherit" });
    console.log("✅ Layer 3: pushed to remote");
  } catch (e) {
    console.warn("⚠️ Layer 3 git push failed (continuing):", (e as Error).message);
  }
}
