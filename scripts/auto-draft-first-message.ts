/**
 * Auto-create drafted first messages for contacts who just accepted a LinkedIn invite.
 *
 * Input: /tmp/newly_accepted.json (written by process-invite-status.ts)
 *
 * For each contact in the file:
 *   - Skip if already has a drafted/sent linkedin_message in outreach_attempts (step 2)
 *   - Insert outreach_attempts:
 *       channel = 'linkedin_message'
 *       step_number = 2
 *       state = 'drafted'
 *       body = Tulip Pesach + Kfar Tikva first message (personalized with name)
 *       subject = NULL
 *       drafted_by = 'agent_auto'
 *       notes = 'Auto-drafted after invite acceptance'
 *
 * The user reviews + sends from the /outreach UI.
 *
 * Usage: pnpm tsx scripts/auto-draft-first-message.ts [--input=/tmp/newly_accepted.json]
 */
import { createClient, type Client } from "@libsql/client";
import fs from "node:fs";

const hasLocal = fs.existsSync("data/crm.db");
const localDb: Client | null = hasLocal ? createClient({ url: "file:./data/crm.db" }) : null;
const remoteDb = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN!,
});

// First-message template — Lotan's EXACT verbatim template (corrected 2026-05-26).
// `{firstName}` placeholder gets replaced per contact.
// DO NOT add clever job-title personalization. "כייף להיות מחוברות פה" is the warmth.
// See: ~/.claude/projects/.../memory/feedback_lotan_actual_voice.md
const FIRST_MESSAGE = (firstName: string) => `היי ${firstName}, מה נשמע?

כייף להיות מחוברות פה.
מקווה שהשגרה הזמנית עושה טוב!

בפסח האחרון עבדנו עם מעל ל-600 חברות בארץ, ולמדנו שכשהשגרה לא יציבה,  הרבה צוותי ניהול כוח אדם מוצאים את עצמם לחוצים לרגע האחרון עם מתנות לחג. כלקח מפסח, החלטנו להקדים את השיח על ראש השנה.

המארזים הקהילתיים שלנו השנה משלבים יינות זוכי פרסים לצד מוצרים מקומיים, והכל מורכב על ידי חברי כפר תקווה,  שותפים שלנו, ברמה היומיומית ביקב ובמיוחד בהכנת מארזים.

אשמח לשלוח לך קטלוג.


לוטן
מנהל שיווק וייצוא
יקב טוליפ`;

function firstNameOf(fullName: string): string {
  return fullName.split(/\s+/)[0];
}

async function main() {
  const inputPath = process.argv.find(a => a.startsWith("--input="))?.split("=")[1] || "/tmp/newly_accepted.json";
  if (!fs.existsSync(inputPath)) {
    console.error(`❌ Input file not found: ${inputPath}`);
    process.exit(1);
  }
  const accepted: { contact_id: number; full_name: string; company: string }[] = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  console.log(`Newly accepted to draft for: ${accepted.length}`);

  let drafted = 0, skipped = 0;
  for (const c of accepted) {
    // Skip if a step-2 linkedin_message already exists
    const existing = await remoteDb.execute({
      sql: `SELECT id FROM outreach_attempts
            WHERE contact_id = ?
              AND channel = 'linkedin_message'
              AND step_number = 2
            LIMIT 1`,
      args: [c.contact_id],
    });
    if (existing.rows.length > 0) {
      skipped++;
      console.log(`  ⚠️  cid=${c.contact_id} ${c.full_name} → already has draft, skipping`);
      continue;
    }

    const body = FIRST_MESSAGE(firstNameOf(c.full_name));
    const sql = `INSERT INTO outreach_attempts
      (contact_id, channel, step_number, subject, body, state, drafted_by, notes, created_at, updated_at)
      VALUES (?, 'linkedin_message', 2, NULL, ?, 'drafted', 'agent_auto', 'Auto-drafted after invite acceptance', datetime('now'), datetime('now'))`;
    const args = [c.contact_id, body];
    await remoteDb.execute({ sql, args });
    if (localDb) await localDb.execute({ sql, args }).catch(() => {});

    // Notify the user
    const notifSql = `INSERT INTO notifications (kind, contact_id, title, body, url, is_read, created_at)
                      VALUES ('draft_ready', ?, ?, ?, ?, 0, datetime('now'))`;
    const notifArgs = [
      c.contact_id,
      `דרפט חדש: ${c.full_name}`,
      `${c.full_name} (${c.company}) אישר/ה את החיבור — דרפט הודעת תשרי מוכן לאישור.`,
      `/outreach`,
    ];
    await remoteDb.execute({ sql: notifSql, args: notifArgs }).catch(() => {});
    if (localDb) await localDb.execute({ sql: notifSql, args: notifArgs }).catch(() => {});

    drafted++;
    console.log(`  ✅ cid=${c.contact_id} ${c.full_name} @ ${c.company} → drafted`);
  }

  console.log(`\n=== Summary ===`);
  console.log(`  ✅ Drafts created: ${drafted}`);
  console.log(`  ⚠️  Skipped (exists): ${skipped}`);
  console.log(`  → User reviews at https://tulip-crm-app.vercel.app/outreach`);
}

main().catch(e => { console.error(e); process.exit(1); });
