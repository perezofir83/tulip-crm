/**
 * Ingest /tmp/today_hr_results.json into the contacts table.
 *
 * Reads accumulator written by the Chrome MCP daily scrape pass:
 *   { "<cid>": { name, slug, status, people: [{full_name, title, profile_url}] } }
 *
 * Filtering rules per person:
 *   - Skip "LinkedIn Member" placeholders / no profile_url
 *   - Skip cross-company false positives: title contains "at|@ <X>" where X
 *     mentions a recognizable company that isn't the target slug/name
 *   - Skip if not HR-ish (title doesn't match any HR keyword)
 *   - Detect welfare/EE/wellbeing → is_welfare=1, role_tag='welfare'
 *   - Detect senior (VP/Chief/Head/CHRO/Director) → is_decision_maker=1
 *
 * Idempotent: dedupes on (company_id, lower(linkedin_url)) before insert.
 */
import { createClient, type Client } from "@libsql/client";
import fs from "node:fs";

const hasLocal = fs.existsSync("data/crm.db");
const localDb: Client | null = hasLocal ? createClient({ url: "file:./data/crm.db" }) : null;
const remoteDb = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN!,
});

const HR_KEYWORDS = [
  "human resource", // matches "human resource" and "human resources"
  "hrbp", "people partner", "people operations",
  "talent", "recruit", "welfare", "wellbeing", "well-being",
  "employee experience", "employee engagement", "ee &", "ee+",
  "chro", "chief people", "vp hr", "vp people", "head of hr",
  "head of people", "organizational",
  "h.r", // "H.R Director" style with period
  "רווחה", "משאבי אנוש", "גיוס",
];

const WELFARE_KEYWORDS = [
  "welfare", "wellbeing", "well-being", "employee experience",
  "employee engagement", "internal communications", "internal comms",
  "ee &", "ee+", "ee/", "ee ", "רווחה",
];

const SENIOR_KEYWORDS = [
  "vp ", " vp", "vice president", "chief", "chro", "head of",
  "director", "senior director", "deputy", "evp ",
];

function classifyTitle(title: string): {
  is_hr: boolean; is_welfare: boolean; is_senior: boolean; role_tag: string;
} {
  const t = title.toLowerCase();
  // Plain substring match — keyword list is curated to avoid false positives
  const is_hr = HR_KEYWORDS.some(k => t.includes(k)) || /\bhr\b/i.test(t);
  const is_welfare = WELFARE_KEYWORDS.some(k => t.includes(k));
  const is_senior = SENIOR_KEYWORDS.some(k => t.includes(k));
  let role_tag = "hr";
  if (is_welfare) role_tag = "welfare";
  else if (is_senior && is_hr) role_tag = "hr_senior";
  else if (/recruit|talent acquisition/i.test(t)) role_tag = "recruiter";
  return { is_hr, is_welfare, is_senior, role_tag };
}

// Detect "at <company-X>" where X is clearly a different employer
function isCrossCompany(title: string, targetName: string, targetSlug: string): boolean {
  const t = title.toLowerCase();
  // Find " at <Company>" or " @ <Company>" patterns
  const m = t.match(/\s+(?:at|@)\s+([a-z][a-z0-9 .\-,&']{2,40})(?:\s+\||$|,)/i);
  if (!m) return false;
  const employer = m[1].trim();
  const targets = [targetName.toLowerCase(), targetSlug.toLowerCase().replace(/-/g, " ")];
  return !targets.some(target => employer.includes(target) || target.includes(employer));
}

async function main() {
  const path = process.env.RESULTS_FILE || "/tmp/today_hr_results.json";
  const acc: Record<string, any> = JSON.parse(fs.readFileSync(path, "utf8"));

  let insertedTotal = 0, skippedTotal = 0, welfareTotal = 0;
  const welfareLeads: { cid: number; co: string; name: string; title: string; url: string }[] = [];

  for (const [cidStr, data] of Object.entries(acc)) {
    const cid = parseInt(cidStr, 10);
    const name = data.name as string;
    const slug = data.slug as string;
    const people = (data.people || []) as { full_name: string; title: string; profile_url: string }[];
    if (!people.length) continue;

    // Load existing contacts for this co (dedupe by linkedin URL)
    const ex = await remoteDb.execute({
      sql: "SELECT lower(linkedin_url) AS u FROM contacts WHERE company_id = ?",
      args: [cid],
    });
    const existing = new Set((ex.rows as any[]).map(r => r.u).filter(Boolean));

    let inserted = 0, skipped = 0;

    for (const p of people) {
      if (!p.full_name || p.full_name === "LinkedIn Member") { skipped++; continue; }
      if (!p.profile_url) { skipped++; continue; }
      const url = p.profile_url.toLowerCase();
      if (existing.has(url)) { skipped++; continue; }

      const cls = classifyTitle(p.title || "");
      if (!cls.is_hr) { skipped++; continue; }
      if (isCrossCompany(p.title || "", name, slug)) { skipped++; continue; }

      const args = [
        cid,
        p.full_name,
        p.title || null,
        p.title || null,            // headline (same for now)
        null,                        // location
        p.profile_url,
        cls.is_welfare ? 1 : 0,
        cls.is_senior && cls.is_hr ? 1 : 0,
        cls.role_tag,
      ];
      const sql = `INSERT INTO contacts
        (company_id, full_name, title, headline, location, linkedin_url,
         is_welfare, is_decision_maker, role_tag, status, scraped_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', datetime('now'))`;
      await remoteDb.execute({ sql, args });
      if (localDb) await localDb.execute({ sql, args }).catch(() => {});
      existing.add(url);
      inserted++;
      if (cls.is_welfare) {
        welfareTotal++;
        welfareLeads.push({ cid, co: name, name: p.full_name, title: p.title, url: p.profile_url });
      }
    }

    insertedTotal += inserted;
    skippedTotal += skipped;
    if (inserted > 0) {
      console.log(`  cid=${cid.toString().padEnd(5)} ${name.padEnd(28).slice(0, 28)} → +${inserted} (skipped ${skipped})`);
    }
  }

  console.log(`\n=== Ingest done ===`);
  console.log(`  contacts inserted: ${insertedTotal}`);
  console.log(`  rows skipped:      ${skippedTotal}`);
  console.log(`  welfare/EE leads:  ${welfareTotal}`);
  if (welfareLeads.length) {
    console.log(`\n🎯 Welfare/EE leads (Tulip gold):`);
    for (const w of welfareLeads) {
      console.log(`  ${w.co.padEnd(20)} ${w.name.padEnd(25)} ${w.title}`);
      console.log(`    → ${w.url}`);
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); });
