/**
 * LinkedIn draft agent — opens N LinkedIn profiles in browser tabs and pre-fills
 * the connection-request message from the drafted outreach attempt.
 *
 * STATUS: stub. Requires `playwright` to be installed AND the user to have an
 * authenticated LinkedIn session (we reuse the persistent context dir).
 *
 * To wire it up later:
 *   1. pnpm add -D playwright
 *   2. npx playwright install chromium
 *   3. one-time: pnpm tsx scripts/agent-linkedin-draft.ts --setup
 *      → opens browser, you log into LinkedIn manually, then close. Cookies are
 *      persisted to data/.playwright-li/.
 *   4. daily: pnpm tsx scripts/agent-linkedin-draft.ts
 *
 * This script intentionally STOPS at "draft ready" — it never clicks Send.
 * The user reviews each tab manually and sends.
 */
import { beginRun, endRun } from "../src/lib/agents";
import { getDb } from "../src/lib/db";

const AGENT_ID = "linkedin-draft-v1";

async function main() {
  const runId = beginRun(AGENT_ID, { mode: process.argv[2] || "run" });
  const db = getDb();

  const drafts = db
    .prepare(
      `SELECT a.id, a.body, c.id AS contact_id, c.full_name, c.linkedin_url
       FROM outreach_attempts a
       JOIN contacts c ON c.id = a.contact_id
       WHERE a.state='drafted' AND a.channel='linkedin_invite'
         AND a.draft_url IS NULL
         AND c.linkedin_url IS NOT NULL
       LIMIT 20`
    )
    .all() as any[];

  if (drafts.length === 0) {
    console.log("No LinkedIn drafts pending browser prep. Run `pnpm agent:daily` first.");
    endRun(runId, "ok", { tabs_opened: 0 });
    return;
  }

  console.log(`Found ${drafts.length} drafts to prepare in browser.`);
  console.log("⚠️  Playwright not yet installed. To enable browser automation:");
  console.log("    pnpm add -D playwright && npx playwright install chromium");
  console.log("    Then re-run this script.");

  // Placeholder: write a "todo" notification per draft so user can do it manually.
  for (const d of drafts) {
    db.prepare(
      `UPDATE outreach_attempts SET draft_url = ? WHERE id = ?`
    ).run(d.linkedin_url, d.id);
    console.log(`  → ${d.full_name}: ${d.linkedin_url}`);
  }
  endRun(runId, "partial", { tabs_opened: 0, manual_urls_recorded: drafts.length });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
