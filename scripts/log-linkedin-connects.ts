/**
 * Log a batch of LinkedIn connection requests sent without a message.
 *
 * Usage: pnpm tsx scripts/log-linkedin-connects.ts <contact_id> <contact_id> ...
 *
 * Each contact gets ONE row in outreach_attempts:
 *   - channel = 'linkedin_connect_no_message'
 *   - subject = NULL (no message)
 *   - body = NULL
 *   - status = 'sent'  (we sent the connect request; awaiting acceptance)
 *   - sent_at = now()
 *
 * Idempotent: if a row already exists with same (contact_id, channel) within
 * the last 30 days, skip — don't double-log.
 */
import { createClient, type Client } from "@libsql/client";
import fs from "node:fs";

const hasLocal = fs.existsSync("data/crm.db");
const localDb: Client | null = hasLocal ? createClient({ url: "file:./data/crm.db" }) : null;
const remoteDb = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN!,
});

async function main() {
  const contactIds = process.argv.slice(2).map(s => parseInt(s, 10)).filter(n => !isNaN(n));
  if (!contactIds.length) {
    console.error("Usage: pnpm tsx scripts/log-linkedin-connects.ts <contact_id> [<contact_id> ...]");
    process.exit(1);
  }

  const SENT_BY = process.env.SENT_BY || "lotan";
  let inserted = 0, skipped = 0;

  for (const cid of contactIds) {
    // Check for recent dup
    const existing = await remoteDb.execute({
      sql: `SELECT id FROM outreach_attempts
            WHERE contact_id = ?
              AND channel = 'linkedin_connect_no_message'
              AND sent_at > datetime('now', '-30 days')
            LIMIT 1`,
      args: [cid],
    });
    if (existing.rows.length > 0) {
      skipped++;
      console.log(`  cid=${cid}  ⚠️  already logged in last 30d, skipping`);
      continue;
    }

    // Get contact + company info for logging
    const info = await remoteDb.execute({
      sql: `SELECT ct.full_name, ct.title, c.name_he AS company
            FROM contacts ct JOIN companies c ON c.id = ct.company_id
            WHERE ct.id = ?`,
      args: [cid],
    });
    if (info.rows.length === 0) {
      console.log(`  cid=${cid}  ❌  contact not found`);
      continue;
    }
    const row = info.rows[0] as any;

    // Insert into outreach_attempts (schema-accurate columns)
    const sql = `INSERT INTO outreach_attempts
      (contact_id, channel, step_number, subject, body, state, sent_by, sent_at, notes, created_at, updated_at)
      VALUES (?, 'linkedin_connect_no_message', 1, NULL, '(LinkedIn connection request — no message)', 'sent', ?, datetime('now'), 'Connect without note, awaiting acceptance', datetime('now'), datetime('now'))`;
    const args = [cid, SENT_BY];
    await remoteDb.execute({ sql, args });
    if (localDb) await localDb.execute({ sql, args }).catch(() => {});

    // Also update contact.last_touch_at + status
    const upSql = `UPDATE contacts
                   SET last_touch_at = datetime('now'),
                       status = CASE WHEN status='new' THEN 'contacted' ELSE status END,
                       updated_at = datetime('now')
                   WHERE id = ?`;
    await remoteDb.execute({ sql: upSql, args: [cid] });
    if (localDb) await localDb.execute({ sql: upSql, args: [cid] }).catch(() => {});

    inserted++;
    console.log(`  ✅ cid=${cid}  ${row.full_name.padEnd(28)} @ ${row.company}`);
  }

  console.log(`\nDone. ${inserted} logged, ${skipped} skipped.`);
}

main().catch(e => { console.error(e); process.exit(1); });
