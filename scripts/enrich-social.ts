/**
 * Daily social enrichment — picks next 70 customers (is_customer=1), fetches their
 * website, extracts Facebook/X/Twitter/Instagram URLs from the HTML, writes back
 * to BOTH local SQLite and Turso. Marks each as `social_enriched_at = now()`.
 *
 * Run: pnpm tsx scripts/enrich-social.ts            # default: 70 cos
 *      BATCH=20 pnpm tsx scripts/enrich-social.ts   # smaller batch
 *
 * Idempotent: re-running picks up where the last run stopped.
 */
import { createClient, type Client } from "@libsql/client";
import fs from "node:fs";

// Local DB is optional — only writes if data/crm.db exists (i.e. running on dev
// machine, not GitHub Actions). Remote (Turso) is always the source of truth.
const hasLocal = fs.existsSync("data/crm.db");
const localDb: Client | null = hasLocal ? createClient({ url: "file:./data/crm.db" }) : null;
const remoteDb = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN!,
});

const BATCH = parseInt(process.env.BATCH || "70", 10);

// Match common social URL patterns in the HTML body
function extractSocialUrls(html: string): {
  facebook: string | null;
  twitter: string | null;
  instagram: string | null;
} {
  const cleaned = html.replace(/\s+/g, " ");
  // Facebook (skip share/like/sharer endpoints)
  const fb =
    cleaned.match(/https?:\/\/(?:www\.|m\.)?facebook\.com\/(?!sharer|tr|plugins|share|dialog\b)[A-Za-z0-9._\-]+\/?/i)?.[0] ?? null;
  // Twitter / X (skip share intents)
  const tw =
    cleaned.match(/https?:\/\/(?:www\.)?(?:twitter\.com|x\.com)\/(?!intent|share|home|search)[A-Za-z0-9_]{1,15}\/?/i)?.[0] ?? null;
  // Instagram
  const ig =
    cleaned.match(/https?:\/\/(?:www\.)?instagram\.com\/(?!p\/|reel\/|explore\/)[A-Za-z0-9._]+\/?/i)?.[0] ?? null;

  return {
    facebook: fb && !/facebook\.com\/?$/.test(fb) ? fb : null,
    twitter: tw && !/(?:twitter|x)\.com\/?$/.test(tw) ? tw : null,
    instagram: ig && !/instagram\.com\/?$/.test(ig) ? ig : null,
  };
}

async function fetchHtml(url: string, timeoutMs = 10000): Promise<string | null> {
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        // Some sites block obvious bots; use a normal UA
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      },
      redirect: "follow",
    });
    clearTimeout(t);
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

async function main() {
  const result = await remoteDb.execute(`
    SELECT id, name_he, website, linkedin_url
    FROM companies
    WHERE is_customer = 1
      AND social_enriched_at IS NULL
    ORDER BY id ASC
    LIMIT ${BATCH}
  `);
  const cos = result.rows as any[];
  console.log(`Picked ${cos.length} customers to enrich.\n`);

  let enriched = 0, skipped = 0, urls_found = 0;

  for (const co of cos) {
    const id = co.id;
    const name = co.name_he;
    const website = co.website;

    let socials = { facebook: null as string | null, twitter: null as string | null, instagram: null as string | null };

    // Try website first
    if (website) {
      const html = await fetchHtml(website);
      if (html) socials = extractSocialUrls(html);
    }

    // If still missing some, try LinkedIn about page
    if (co.linkedin_url && (!socials.facebook || !socials.twitter || !socials.instagram)) {
      const html = await fetchHtml(co.linkedin_url.replace(/\/?$/, "/about/"));
      if (html) {
        const fromLi = extractSocialUrls(html);
        socials.facebook ||= fromLi.facebook;
        socials.twitter ||= fromLi.twitter;
        socials.instagram ||= fromLi.instagram;
      }
    }

    const found = [socials.facebook, socials.twitter, socials.instagram].filter(Boolean).length;
    urls_found += found;

    // Update both DBs
    const updates = {
      facebook_url: socials.facebook,
      twitter_url: socials.twitter,
      instagram_url: socials.instagram,
    };
    const updateSql = `
      UPDATE companies SET
        facebook_url  = COALESCE(?, facebook_url),
        twitter_url   = COALESCE(?, twitter_url),
        instagram_url = COALESCE(?, instagram_url),
        social_enriched_at = datetime('now'),
        updated_at = datetime('now')
      WHERE id = ?
    `;
    const args = [updates.facebook_url, updates.twitter_url, updates.instagram_url, id];
    await remoteDb.execute({ sql: updateSql, args });
    if (localDb) await localDb.execute({ sql: updateSql, args });

    if (found > 0) {
      enriched++;
      console.log(`  ✅ cid=${id} ${String(name).slice(0, 30).padEnd(30)} → ${found} URLs ${socials.facebook ? "[FB]" : ""}${socials.twitter ? "[X]" : ""}${socials.instagram ? "[IG]" : ""}`);
    } else {
      skipped++;
      console.log(`  -- cid=${id} ${String(name).slice(0, 30).padEnd(30)} → no social links found`);
    }
  }

  console.log(`\n✅ Done. ${enriched} enriched, ${skipped} no-result, ${urls_found} URLs total.`);
  console.log(`   Re-run \`pnpm tsx scripts/enrich-social.ts\` tomorrow for the next batch.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
