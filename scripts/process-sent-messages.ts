/**
 * Process detected sent messages: match by contact name to a drafted outreach_attempt
 * and mark it state='sent' with the actual body captured.
 *
 * Input: /tmp/sent_messages.json — written by Chrome MCP scan of LinkedIn messaging.
 *   [{ name: "Galit Herzenshtein", body: "...", sent_at: "2026-05-26 ..." }, ...]
 *
 * Match logic:
 *   - Normalize names (trim/lowercase)
 *   - Find contact by full_name
 *   - Find latest outreach_attempts row where channel='linkedin_message' and state='drafted'
 *   - If body is "different enough" from the existing draft → use the actual sent body
 *     (capturing how Lotan edited it before sending)
 *
 * Idempotent: skip if already state='sent' with same body.
 */
import { createClient, type Client } from "@libsql/client";
import fs from "node:fs";

const hasLocal = fs.existsSync("data/crm.db");
const localDb: Client | null = hasLocal ? createClient({ url: "file:./data/crm.db" }) : null;
const remoteDb = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN!,
});

function normName(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

async function main() {
  const inputPath = process.argv.find(a => a.startsWith("--input="))?.split("=")[1] || "/tmp/sent_messages.json";
  if (!fs.existsSync(inputPath)) {
    console.log(`No sent-messages file at ${inputPath} — nothing to process.`);
    return;
  }
  const sent: { name: string; body: string; sent_at?: string }[] = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  console.log(`Detected sent messages: ${sent.length}`);
  if (!sent.length) return;

  // Build contacts map (only those with drafted outreach)
  const r = await remoteDb.execute(`
    SELECT ct.id AS cid, ct.full_name, c.name_he AS company,
           oa.id AS oa_id, oa.body AS draft_body
    FROM contacts ct
    JOIN companies c ON c.id = ct.company_id
    JOIN outreach_attempts oa ON oa.contact_id = ct.id
    WHERE oa.channel = 'linkedin_message'
      AND oa.state = 'drafted'
  `);
  const draftMap = new Map<string, { cid: number; full_name: string; company: string; oa_id: number; draft_body: string }>();
  for (const row of r.rows as any[]) {
    draftMap.set(normName(row.full_name), {
      cid: row.cid, full_name: row.full_name, company: row.company,
      oa_id: row.oa_id, draft_body: row.draft_body || "",
    });
  }

  let marked = 0, skipped = 0, unmatched = 0;

  for (const msg of sent) {
    const target = draftMap.get(normName(msg.name));
    if (!target) {
      unmatched++;
      continue;
    }
    if (!msg.body || msg.body.length < 30) {
      skipped++;
      continue; // too short to be a real message
    }

    // Mark as sent — capture actual body if different
    const sentAt = msg.sent_at || new Date().toISOString().replace("T", " ").replace(/\..+$/, "");
    const sql = `UPDATE outreach_attempts
                 SET body = ?,
                     state = 'sent',
                     sent_by = 'lotan',
                     sent_at = ?,
                     notes = COALESCE(notes, '') || ' | Detected sent on LinkedIn, body captured ' || datetime('now'),
                     updated_at = datetime('now')
                 WHERE id = ? AND state = 'drafted'`;
    const args = [msg.body, sentAt, target.oa_id];
    const res = await remoteDb.execute({ sql, args });
    if (localDb) await localDb.execute({ sql, args }).catch(() => {});
    if (res.rowsAffected === 0) {
      skipped++;
      continue;
    }

    // Advance contact status
    const upSql = `UPDATE contacts SET status = 'conversation_started', last_touch_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`;
    await remoteDb.execute({ sql: upSql, args: [target.cid] });
    if (localDb) await localDb.execute({ sql: upSql, args: [target.cid] }).catch(() => {});

    marked++;
    console.log(`  ✅ ${target.full_name.padEnd(28)} @ ${target.company.padEnd(20)} → marked sent (oa_id=${target.oa_id})`);
  }

  console.log(`\n=== Summary ===`);
  console.log(`  Marked sent: ${marked}`);
  console.log(`  Skipped:     ${skipped}`);
  console.log(`  Unmatched:   ${unmatched} (sent to someone not in our drafted list)`);
}

main().catch(e => { console.error(e); process.exit(1); });
