/**
 * Daily 70-company full enrichment.
 *
 * Pipeline (per company):
 *   Phase A: Fetch website HTML
 *            → extract Facebook/X/Instagram URLs (regex)
 *            → extract LinkedIn /company/<slug>/ URL from footer (if missing)
 *   Phase B: If LinkedIn still missing → DuckDuckGo HTML search fallback
 *   Phase C: If LinkedIn known but socials still missing → fetch LinkedIn /about/
 *
 * Phase D (HR contacts) lives in a separate run (needs Chrome MCP, not fetch).
 *
 * Prioritization: existing customers + missing data first, then large prospects.
 * Default batch = 70. Override with BATCH=N pnpm tsx scripts/enrich-daily.ts
 *
 * Idempotent. Writes social_enriched_at on every visit so the next run picks a new batch.
 */
import { createClient, type Client } from "@libsql/client";
import fs from "node:fs";

const hasLocal = fs.existsSync("data/crm.db");
const localDb: Client | null = hasLocal ? createClient({ url: "file:./data/crm.db" }) : null;
const remoteDb = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN!,
});

const BATCH = parseInt(process.env.BATCH || "70", 10);

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

async function fetchHtml(url: string, timeoutMs = 12000): Promise<string | null> {
  try {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), timeoutMs);
    const res = await fetch(url, {
      signal: c.signal,
      headers: { "user-agent": UA, "accept-language": "en-US,en;q=0.9,he;q=0.8" },
      redirect: "follow",
    });
    clearTimeout(t);
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

function extractSocial(html: string) {
  const s = html.replace(/\s+/g, " ");
  const fb = s.match(/https?:\/\/(?:www\.|m\.)?facebook\.com\/(?!sharer|tr|plugins|share|dialog\b)[A-Za-z0-9._\-]+\/?/i)?.[0] ?? null;
  const tw = s.match(/https?:\/\/(?:www\.)?(?:twitter\.com|x\.com)\/(?!intent|share|home|search)[A-Za-z0-9_]{1,15}\/?/i)?.[0] ?? null;
  const ig = s.match(/https?:\/\/(?:www\.)?instagram\.com\/(?!p\/|reel\/|explore\/)[A-Za-z0-9._]+\/?/i)?.[0] ?? null;
  return {
    facebook: fb && !/facebook\.com\/?$/.test(fb) ? fb : null,
    twitter: tw && !/(?:twitter|x)\.com\/?$/.test(tw) ? tw : null,
    instagram: ig && !/instagram\.com\/?$/.test(ig) ? ig : null,
  };
}

// LinkedIn /company/<slug>/ — proven footer pattern. Slugs allow lowercase, digits, hyphens, underscores, &, ., utf8.
const LI_RE = /https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/company\/([a-z0-9\-._&]+)/i;
function extractLinkedIn(html: string): string | null {
  const m = html.match(LI_RE);
  if (!m) return null;
  const slug = m[1].replace(/[.]$/, ""); // strip trailing period
  // Skip obvious junk slugs
  if (/^(showcase|setup|admin|login|jobs|help)$/i.test(slug)) return null;
  return `https://www.linkedin.com/company/${slug.toLowerCase()}/`;
}

// DuckDuckGo HTML fallback — no JS, no rate limit
async function ddgFindLinkedIn(name: string): Promise<string | null> {
  const q = encodeURIComponent(`"${name}" site:linkedin.com/company`);
  const url = `https://html.duckduckgo.com/html/?q=${q}`;
  const html = await fetchHtml(url, 10000);
  if (!html) return null;
  // DDG wraps redirects: /l/?uddg=<encoded-real-url>
  const re = /uddg=(https?%3A%2F%2F[^"&]*linkedin\.com%2Fcompany%2F[^"&]+)/i;
  const m = html.match(re);
  if (m) {
    try {
      const decoded = decodeURIComponent(m[1]);
      return extractLinkedIn(decoded);
    } catch { /* fall through */ }
  }
  // Direct match (sometimes DDG inlines)
  return extractLinkedIn(html);
}

type Row = {
  id: number; name_he: string; website: string | null; linkedin_url: string | null;
  is_customer: number; emp_count: number | null; business_alive: string | null;
  social_enriched_at: string | null;
  facebook_url: string | null; twitter_url: string | null; instagram_url: string | null;
  contact_count: number;
};

async function pickBatch(): Promise<Row[]> {
  const r = await remoteDb.execute(`
    SELECT
      c.id, c.name_he, c.website, c.linkedin_url, c.is_customer, c.emp_count, c.business_alive,
      c.social_enriched_at, c.facebook_url, c.twitter_url, c.instagram_url,
      (SELECT COUNT(*) FROM contacts ct WHERE ct.company_id = c.id) AS contact_count,
      (
        CASE WHEN c.is_customer=1 AND c.social_enriched_at IS NULL THEN 100 ELSE 0 END
        + CASE WHEN c.linkedin_url IS NULL OR c.linkedin_url='' THEN 50 ELSE 0 END
        + CASE WHEN c.linkedin_url IS NOT NULL AND c.linkedin_url!=''
                AND (SELECT COUNT(*) FROM contacts ct2 WHERE ct2.company_id = c.id) = 0
               THEN 30 ELSE 0 END
        + CASE WHEN c.business_alive='yes' THEN 10 ELSE 0 END
        + MIN(COALESCE(c.emp_count,0)/100, 50)
      ) AS score
    FROM companies c
    WHERE c.website IS NOT NULL AND c.website != ''
      AND NOT (
        c.social_enriched_at IS NOT NULL
        AND c.linkedin_url IS NOT NULL AND c.linkedin_url != ''
        AND (SELECT COUNT(*) FROM contacts ct3 WHERE ct3.company_id = c.id) > 0
      )
    ORDER BY score DESC, COALESCE(c.emp_count,0) DESC, c.id ASC
    LIMIT ${BATCH}
  `);
  return r.rows as unknown as Row[];
}

async function update(id: number, fields: Record<string, string | null>) {
  const sets = Object.keys(fields).map(k => `${k} = COALESCE(?, ${k})`);
  sets.push(`social_enriched_at = datetime('now')`);
  sets.push(`updated_at = datetime('now')`);
  const args = [...Object.values(fields), id];
  const sql = `UPDATE companies SET ${sets.join(", ")} WHERE id = ?`;
  await remoteDb.execute({ sql, args });
  if (localDb) await localDb.execute({ sql, args }).catch(() => {});
}

async function main() {
  const rows = await pickBatch();
  console.log(`Picked ${rows.length} companies. Starting enrichment...\n`);

  let enrichedSocial = 0, foundLinkedIn = 0, fbCount = 0, twCount = 0, igCount = 0;
  const liDiscovered: { id: number; name: string; url: string }[] = [];

  for (let i = 0; i < rows.length; i++) {
    const co = rows[i];
    const tag = `[${(i + 1).toString().padStart(2, " ")}/${rows.length}] cid=${co.id}`;
    const name = String(co.name_he).slice(0, 32).padEnd(32);

    let socials = { facebook: null as string | null, twitter: null as string | null, instagram: null as string | null };
    let linkedinUrl: string | null = null;

    // Phase A — website
    if (co.website) {
      const html = await fetchHtml(co.website);
      if (html) {
        socials = extractSocial(html);
        if (!co.linkedin_url) linkedinUrl = extractLinkedIn(html);
      }
    }

    // Phase B — DuckDuckGo fallback for LinkedIn
    if (!co.linkedin_url && !linkedinUrl) {
      linkedinUrl = await ddgFindLinkedIn(co.name_he);
      if (linkedinUrl) await new Promise(r => setTimeout(r, 1500)); // be polite to DDG
    }

    // Phase C — LinkedIn /about/ for missing socials
    const liUrl = co.linkedin_url || linkedinUrl;
    if (liUrl && (!socials.facebook || !socials.twitter || !socials.instagram)) {
      const html = await fetchHtml(liUrl.replace(/\/?$/, "/about/"));
      if (html) {
        const li = extractSocial(html);
        socials.facebook ||= li.facebook;
        socials.twitter ||= li.twitter;
        socials.instagram ||= li.instagram;
      }
    }

    const updates: Record<string, string | null> = {
      facebook_url: socials.facebook,
      twitter_url: socials.twitter,
      instagram_url: socials.instagram,
    };
    if (linkedinUrl) updates.linkedin_url = linkedinUrl;
    await update(co.id, updates);

    const found = [socials.facebook, socials.twitter, socials.instagram].filter(Boolean).length;
    if (socials.facebook) fbCount++;
    if (socials.twitter) twCount++;
    if (socials.instagram) igCount++;
    if (found > 0) enrichedSocial++;
    if (linkedinUrl) {
      foundLinkedIn++;
      liDiscovered.push({ id: co.id, name: co.name_he, url: linkedinUrl });
    }

    const badges = [
      linkedinUrl ? "[LI-NEW]" : co.linkedin_url ? "[LI]" : "",
      socials.facebook ? "[FB]" : "",
      socials.twitter ? "[X]" : "",
      socials.instagram ? "[IG]" : "",
    ].filter(Boolean).join("");
    console.log(`  ${tag} ${name} ${found} socials ${badges}`);
  }

  console.log(`\n=== Done. ${rows.length} companies processed ===`);
  console.log(`Social enriched:    ${enrichedSocial}/${rows.length}  (${Math.round(100 * enrichedSocial / rows.length)}%)`);
  console.log(`  facebook URLs:    ${fbCount}`);
  console.log(`  twitter/X URLs:   ${twCount}`);
  console.log(`  instagram URLs:   ${igCount}`);
  console.log(`LinkedIn discovered:${foundLinkedIn}`);
  if (liDiscovered.length) {
    console.log(`\nNew LinkedIn URLs:`);
    for (const d of liDiscovered) console.log(`  cid=${d.id}  ${d.name}  →  ${d.url}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
