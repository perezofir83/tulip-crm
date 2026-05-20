/**
 * Imports companies + HR Contacts from the live Google Sheet via the gws CLI.
 * Run AFTER `pnpm db:init`.
 *
 * Strategy: full overwrite of companies/contacts tables from sheet (sheet is
 * authoritative for raw lead data). User-generated tables (outreach_attempts,
 * deals, kb_objections, notes) are NEVER touched.
 */
import { execSync } from "node:child_process";
import { getDb } from "../src/lib/db";

const SHEET = process.env.TULIP_SHEET_ID || "1ZYJKkgDx34TPCOgmMDtG26LD_T22OPlcjOMdqgtyvIg";

function gwsGet(range: string): string[][] {
  const params = JSON.stringify({ spreadsheetId: SHEET, range });
  const raw = execSync(
    `gws sheets spreadsheets values get --params '${params.replace(/'/g, "'\\''")}'`,
    { encoding: "utf8", maxBuffer: 50 * 1024 * 1024 }
  );
  // gws prints a "Using keyring backend:" prefix line — strip everything before the first {.
  const start = raw.indexOf("{");
  const parsed = JSON.parse(raw.slice(start));
  return parsed.values || [];
}

const db = getDb();

// ---------- Companies tab ----------
console.log("→ Reading Companies tab...");
const compRows = gwsGet("Companies!A2:U3000");
console.log(`  got ${compRows.length} rows`);

const upsertCo = db.prepare(`
  INSERT INTO companies (
    id, name_he, category, description, location, emp_count, emp_confidence,
    business_alive, website, linkedin_url, linkedin_followers, linkedin_size_range,
    linkedin_industries, public_emails, source_url, notes, scraped_at, updated_at
  ) VALUES (
    @id, @name_he, @category, @description, @location, @emp_count, @emp_confidence,
    @business_alive, @website, @linkedin_url, @linkedin_followers, @linkedin_size_range,
    @linkedin_industries, @public_emails, @source_url, @notes, @scraped_at, datetime('now')
  )
  ON CONFLICT(id) DO UPDATE SET
    name_he = excluded.name_he,
    category = excluded.category,
    description = excluded.description,
    location = excluded.location,
    emp_count = excluded.emp_count,
    emp_confidence = excluded.emp_confidence,
    business_alive = excluded.business_alive,
    website = excluded.website,
    linkedin_url = excluded.linkedin_url,
    linkedin_followers = excluded.linkedin_followers,
    linkedin_size_range = excluded.linkedin_size_range,
    linkedin_industries = excluded.linkedin_industries,
    public_emails = excluded.public_emails,
    source_url = excluded.source_url,
    scraped_at = excluded.scraped_at,
    updated_at = datetime('now')
`);

function num(v: string | undefined): number | null {
  if (!v) return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

let coInserted = 0;
const coTxn = db.transaction(() => {
  for (const r of compRows) {
    if (!r[0]) continue;
    const id = num(r[0]);
    if (id == null) continue;
    upsertCo.run({
      id,
      name_he: r[1] || "",
      category: r[3] || null,
      description: r[7] || null,
      location: r[4] || null,
      emp_count: num(r[6]),
      emp_confidence: r[12] || null,
      business_alive: r[13] || null,
      website: r[2] || null,
      linkedin_url: r[15] || null,
      linkedin_followers: num(r[18]),
      linkedin_size_range: r[17] || null,
      linkedin_industries: r[20] || null,
      public_emails: r[8] || null,
      source_url: r[9] || null,
      notes: r[14] || null,
      scraped_at: r[10] || null,
    });
    coInserted++;
  }
});
coTxn();
console.log(`✅ companies: ${coInserted} rows upserted`);

// ---------- HR Contacts tab ----------
console.log("→ Reading HR Contacts tab...");
const hrRows = gwsGet("HR Contacts!A2:I3000");
console.log(`  got ${hrRows.length} rows`);

// Match LinkedIn URL → existing contact (per-company de-dup on URL).
// If no URL, fall back to (company_id, full_name).
const findExisting = db.prepare(`
  SELECT id FROM contacts
  WHERE company_id = ? AND (linkedin_url = ? OR (linkedin_url IS NULL AND full_name = ?))
  LIMIT 1
`);
const insertContact = db.prepare(`
  INSERT INTO contacts (
    company_id, full_name, title, location, headline, linkedin_url, scraped_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
`);
const updateContact = db.prepare(`
  UPDATE contacts SET
    title = COALESCE(?, title),
    location = COALESCE(?, location),
    headline = COALESCE(?, headline),
    linkedin_url = COALESCE(?, linkedin_url),
    scraped_at = COALESCE(?, scraped_at),
    updated_at = datetime('now')
  WHERE id = ?
`);

// Tag welfare/EE based on title text
const WELFARE_PATTERN =
  /welfare|wellbeing|well-being|employee experience|employee engagement|רווחה|חוויית עובד/i;

let hrInserted = 0, hrUpdated = 0;
const hrTxn = db.transaction(() => {
  for (const r of hrRows) {
    const cid = num(r[0]);
    const name = (r[2] || "").trim();
    if (cid == null || !name) continue;
    const title = (r[3] || "").trim();
    const url = (r[4] || "").trim() || null;
    const loc = (r[5] || "").trim() || null;
    const headline = (r[6] || "").trim() || null;
    const scraped = (r[8] || "").trim() || null;
    const existing = findExisting.get(cid, url, name) as { id: number } | undefined;
    if (existing) {
      updateContact.run(title || null, loc, headline, url, scraped, existing.id);
      hrUpdated++;
    } else {
      const info = insertContact.run(cid, name, title || null, loc, headline, url, scraped);
      // Set welfare flag for new contacts based on title
      if (title && WELFARE_PATTERN.test(title)) {
        db.prepare("UPDATE contacts SET is_welfare = 1, role_tag = 'welfare_EE' WHERE id = ?")
          .run(info.lastInsertRowid);
      }
      hrInserted++;
    }
  }
});
hrTxn();

// Re-tag welfare/EE across the board (idempotent — refresh on every import)
db.exec(`
  UPDATE contacts SET is_welfare = 1, role_tag = COALESCE(role_tag, 'welfare_EE')
  WHERE title IS NOT NULL AND (
    LOWER(title) LIKE '%welfare%' OR LOWER(title) LIKE '%wellbeing%'
    OR LOWER(title) LIKE '%well-being%' OR LOWER(title) LIKE '%employee experience%'
    OR LOWER(title) LIKE '%employee engagement%' OR title LIKE '%רווחה%'
    OR title LIKE '%חוויית עובד%'
  );
`);

console.log(`✅ contacts: ${hrInserted} inserted, ${hrUpdated} updated`);

// ---------- Summary ----------
const counts = db
  .prepare(`
    SELECT
      (SELECT COUNT(*) FROM companies) AS companies,
      (SELECT COUNT(*) FROM companies WHERE linkedin_url IS NOT NULL AND linkedin_url != '') AS with_linkedin,
      (SELECT COUNT(*) FROM contacts) AS contacts,
      (SELECT COUNT(*) FROM contacts WHERE is_welfare = 1) AS welfare_contacts
  `)
  .get();
console.log("📊", counts);
