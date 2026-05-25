/**
 * Process LinkedIn message replies detected from messaging inbox.
 *
 * Input: /tmp/linkedin_replies.json — array of { name, body, received_at }
 *        (scraped from LinkedIn /messaging/ via Chrome MCP, unread/recent threads)
 *
 * Logic per reply:
 *   - Match `name` to a contact in our DB (case-insensitive on full_name)
 *   - Skip if a reply with same (contact_id, body) already exists in last 7d (dedup)
 *   - INSERT INTO replies (contact_id, attempt_id, channel='linkedin_message',
 *                          body, requires_attention=1, received_at=now())
 *   - UPDATE contacts.last_inbound_at = now(), status = 'replied'
 *   - INSERT notifications (kind='reply', title=..., body=excerpt)
 *
 * Heuristic sentiment classifier (lightweight, no LLM):
 *   - Positive words → intent='interested', sentiment='positive'
 *   - Negative/decline words → intent='declined', sentiment='negative'
 *   - Otherwise → neutral / needs human review
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

function classify(body: string): { sentiment: string | null; intent: string | null } {
  const t = body.toLowerCase();
  const positive = ["שלחי", "אשמח", "תשלחי", "כן", "מעניין", "סקרן", "yes", "interested", "send", "תשלח", "happy to", "let me know", "love to"];
  const negative = ["לא רלוונטי", "לא תודה", "לא מעוניין", "תורידי", "להסיר", "not interested", "no thanks", "remove", "unsubscribe"];
  const question = ["איך", "כמה", "מתי", "מי", "מה ה", "?", "how", "what", "when", "price"];
  if (negative.some(k => t.includes(k))) return { sentiment: "negative", intent: "declined" };
  if (positive.some(k => t.includes(k))) return { sentiment: "positive", intent: "interested" };
  if (question.some(k => t.includes(k))) return { sentiment: "neutral", intent: "question" };
  return { sentiment: null, intent: null };
}

async function main() {
  const inputPath = process.argv.find(a => a.startsWith("--input="))?.split("=")[1] || "/tmp/linkedin_replies.json";
  if (!fs.existsSync(inputPath)) {
    console.error(`❌ Input file not found: ${inputPath}`);
    process.exit(1);
  }
  const replies: { name: string; body: string; received_at?: string }[] = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  console.log(`Detected replies in input: ${replies.length}`);

  // Load contacts map
  const ctRes = await remoteDb.execute(`
    SELECT ct.id, ct.full_name, c.name_he AS company
    FROM contacts ct JOIN companies c ON c.id = ct.company_id
    WHERE ct.last_touch_at IS NOT NULL
  `);
  const nameMap = new Map<string, { id: number; name: string; company: string }>();
  for (const r of ctRes.rows as any[]) {
    nameMap.set(normName(r.full_name), { id: r.id, name: r.full_name, company: r.company });
  }

  let inserted = 0, skipped = 0, unmatched = 0;

  for (const reply of replies) {
    const match = nameMap.get(normName(reply.name));
    if (!match) {
      unmatched++;
      console.log(`  ❓ unmatched name: "${reply.name}" — not in our touched-contacts list, skipping`);
      continue;
    }

    // Dedup: same body in last 7d
    const dup = await remoteDb.execute({
      sql: `SELECT id FROM replies
            WHERE contact_id = ?
              AND body = ?
              AND received_at > datetime('now', '-7 days')
            LIMIT 1`,
      args: [match.id, reply.body],
    });
    if (dup.rows.length > 0) {
      skipped++;
      continue;
    }

    // Find the most recent outreach_attempt to link to
    const lastAttempt = await remoteDb.execute({
      sql: `SELECT id FROM outreach_attempts
            WHERE contact_id = ? AND state IN ('sent','accepted')
            ORDER BY sent_at DESC LIMIT 1`,
      args: [match.id],
    });
    const attemptId = (lastAttempt.rows[0] as any)?.id || null;

    const cls = classify(reply.body);
    const receivedAt = reply.received_at || new Date().toISOString().replace("T", " ").replace(/\..+$/, "");

    // Insert into replies
    const sql = `INSERT INTO replies
      (contact_id, attempt_id, channel, body, sentiment, intent, requires_attention, received_at, detected_at)
      VALUES (?, ?, 'linkedin_message', ?, ?, ?, 1, ?, datetime('now'))`;
    const args = [match.id, attemptId, reply.body, cls.sentiment, cls.intent, receivedAt];
    await remoteDb.execute({ sql, args });
    if (localDb) await localDb.execute({ sql, args }).catch(() => {});

    // Update contact
    const upSql = `UPDATE contacts
                   SET last_inbound_at = datetime('now'),
                       status = 'replied',
                       updated_at = datetime('now')
                   WHERE id = ?`;
    await remoteDb.execute({ sql: upSql, args: [match.id] });
    if (localDb) await localDb.execute({ sql: upSql, args: [match.id] }).catch(() => {});

    // Mark original outreach_attempt as 'replied' (if any)
    if (attemptId) {
      const upOa = `UPDATE outreach_attempts SET state='replied', updated_at=datetime('now') WHERE id=?`;
      await remoteDb.execute({ sql: upOa, args: [attemptId] });
      if (localDb) await localDb.execute({ sql: upOa, args: [attemptId] }).catch(() => {});
    }

    // Notify
    const excerpt = reply.body.slice(0, 160) + (reply.body.length > 160 ? "…" : "");
    const notifTitle = `${match.name} (${match.company}) ענתה`;
    const notifSql = `INSERT INTO notifications (kind, contact_id, title, body, url, is_read, created_at)
                      VALUES ('reply', ?, ?, ?, ?, 0, datetime('now'))`;
    const notifArgs = [match.id, notifTitle, excerpt + (cls.intent ? ` [${cls.intent}]` : ""), `/contacts/${match.id}`];
    await remoteDb.execute({ sql: notifSql, args: notifArgs }).catch(() => {});
    if (localDb) await localDb.execute({ sql: notifSql, args: notifArgs }).catch(() => {});

    inserted++;
    console.log(`  💬 cid=${match.id} ${match.name} → ${cls.intent || 'neutral'} | "${excerpt.slice(0, 80)}"`);
  }

  console.log(`\n=== Summary ===`);
  console.log(`  💬 Replies logged: ${inserted}`);
  console.log(`  ⚠️  Skipped (dup): ${skipped}`);
  console.log(`  ❓ Unmatched names: ${unmatched}`);
}

main().catch(e => { console.error(e); process.exit(1); });
