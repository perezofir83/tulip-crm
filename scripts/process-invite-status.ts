/**
 * Process LinkedIn invitation acceptance status.
 *
 * Input: /tmp/pending_invites.json — array of names currently still pending
 *        (scraped from LinkedIn /mynetwork/invitation-manager/sent/ via Chrome MCP)
 *
 * Logic:
 *   For each outreach_attempts row where channel='linkedin_connect_no_message' and state='sent':
 *     - If contact name IS in pending list → still pending (no change)
 *     - If contact name NOT in pending list → ACCEPTED:
 *         - UPDATE state='accepted', updated_at=now()
 *         - UPDATE contacts.status='engaged' (if currently 'contacted')
 *         - Print to summary (caller can then call auto-drafter)
 *     - If sent_at > 14 days ago AND still pending → mark state='declined'
 *
 * Output: prints summary, exits 0. Writes JSON to /tmp/newly_accepted.json with cids.
 *
 * Usage: pnpm tsx scripts/process-invite-status.ts [--input=/path/to/pending.json]
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
  const inputPath = process.argv.find(a => a.startsWith("--input="))?.split("=")[1] || "/tmp/pending_invites.json";
  if (!fs.existsSync(inputPath)) {
    console.error(`❌ Input file not found: ${inputPath}`);
    console.error("Run Chrome MCP scrape first to populate it.");
    process.exit(1);
  }
  const pendingArr: string[] = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  const pendingSet = new Set(pendingArr.map(normName));
  console.log(`Pending list size: ${pendingSet.size}`);

  // Load all sent connects awaiting status
  const r = await remoteDb.execute(`
    SELECT oa.id AS oa_id, oa.contact_id, oa.sent_at,
           ct.full_name, ct.linkedin_url, ct.status,
           c.name_he AS company
    FROM outreach_attempts oa
    JOIN contacts ct ON ct.id = oa.contact_id
    JOIN companies c ON c.id = ct.company_id
    WHERE oa.channel = 'linkedin_connect_no_message'
      AND oa.state = 'sent'
  `);
  const sentInvites = r.rows as any[];
  console.log(`Sent invites awaiting status: ${sentInvites.length}`);

  let acceptedCount = 0, stillPendingCount = 0, declinedCount = 0;
  const newlyAccepted: { contact_id: number; full_name: string; company: string }[] = [];

  for (const inv of sentInvites) {
    const inPending = pendingSet.has(normName(inv.full_name));
    const sentAt = new Date(inv.sent_at + "Z");
    const daysSince = (Date.now() - sentAt.getTime()) / (1000 * 60 * 60 * 24);

    if (inPending) {
      // Still pending — check if too old
      if (daysSince > 14) {
        // Mark as declined (LinkedIn invites auto-expire after ~14 days)
        await update("declined", inv.oa_id);
        declinedCount++;
        console.log(`  ⏰ cid=${inv.contact_id} ${inv.full_name} → declined (${Math.round(daysSince)}d old)`);
      } else {
        stillPendingCount++;
      }
    } else {
      // Not in pending = ACCEPTED
      await update("accepted", inv.oa_id);
      // Bump contact status: contacted → engaged
      const upStatus = `UPDATE contacts SET status='engaged', updated_at=datetime('now')
                       WHERE id = ? AND status IN ('new', 'contacted')`;
      await remoteDb.execute({ sql: upStatus, args: [inv.contact_id] });
      if (localDb) await localDb.execute({ sql: upStatus, args: [inv.contact_id] }).catch(() => {});
      acceptedCount++;
      newlyAccepted.push({ contact_id: inv.contact_id, full_name: inv.full_name, company: inv.company });
      console.log(`  ✅ cid=${inv.contact_id} ${inv.full_name} @ ${inv.company} → ACCEPTED`);
    }
  }

  // Write newly-accepted for the auto-drafter to pick up
  const outPath = "/tmp/newly_accepted.json";
  fs.writeFileSync(outPath, JSON.stringify(newlyAccepted, null, 2));

  console.log(`\n=== Summary ===`);
  console.log(`  ✅ Newly accepted: ${acceptedCount}`);
  console.log(`  ⏳ Still pending:  ${stillPendingCount}`);
  console.log(`  ⏰ Marked declined: ${declinedCount}`);
  console.log(`  → wrote ${outPath} for auto-drafter`);
}

async function update(newState: string, oaId: number) {
  const sql = `UPDATE outreach_attempts SET state=?, updated_at=datetime('now') WHERE id=?`;
  await remoteDb.execute({ sql, args: [newState, oaId] });
  if (localDb) await localDb.execute({ sql, args: [newState, oaId] }).catch(() => {});
}

main().catch(e => { console.error(e); process.exit(1); });
