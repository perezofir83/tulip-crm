/**
 * Daily outreach agent — picks 20-30 leads, drafts messages, leaves them
 * sitting in state='drafted' for human review.
 *
 * MVP behavior (no browser yet):
 *   - pickDailyBatch()
 *   - render template for each contact
 *   - createDraft()  → notification raised
 *
 * NEXT-STEP TODO (when Chrome MCP / Playwright is wired up):
 *   - scrape contact's latest LinkedIn post / X activity → pass as {{recent_post}}
 *   - open LinkedIn tab to /in/<slug>, click Connect, paste draft, STOP (don't send)
 *   - capture the live tab URL, store as draft_url for one-click review
 *
 * Run: pnpm agent:daily              # default budget 25
 *      BUDGET=30 pnpm agent:daily
 */
import { beginRun, createDraft, endRun, pickDailyBatch, renderTemplate } from "../src/lib/agents";
import { getDb } from "../src/lib/db";

const AGENT_ID = "daily-outreach-v1";

const budget = parseInt(process.env.BUDGET || "25", 10);
const runId = beginRun(AGENT_ID, { budget });

let drafted = 0, skipped = 0, errors = 0;
try {
  const db = getDb();
  const tpls = db
    .prepare("SELECT slug, body, subject FROM templates WHERE is_active = 1")
    .all() as { slug: string; body: string; subject: string | null }[];
  const byslug = new Map(tpls.map((t) => [t.slug, t]));

  const batch = pickDailyBatch({ budget });
  console.log(`Picked ${batch.length} contacts.`);

  for (const c of batch) {
    const tpl = byslug.get(c.template_slug);
    if (!tpl) {
      skipped++;
      console.warn(`  skip ${c.full_name}: template ${c.template_slug} missing`);
      continue;
    }
    const firstName = c.full_name.split(/\s+/)[0];
    const rendered = renderTemplate(tpl.body, {
      first_name: firstName,
      name: c.full_name,
      company: c.company,
      role: c.role_tag || "",
      social_proof_co: "אחת מ-20 חברות הייטק שעבדנו איתן השנה",
      price_from: "85",
      recent_post: "", // TODO: fill from LinkedIn scrape
    });
    try {
      createDraft({
        agent_id: AGENT_ID,
        run_id: runId,
        contact_id: c.contact_id,
        channel: c.next_channel,
        step_number: c.current_step + 1,
        template_slug: c.template_slug,
        rendered_body: rendered,
        subject: tpl.subject || null,
        draft_url: null, // filled by browser-automation step
      });
      drafted++;
      console.log(`  ✅ ${c.full_name} @ ${c.company} → ${c.next_channel} step ${c.current_step + 1}`);
    } catch (e) {
      errors++;
      console.error(`  ❌ ${c.full_name}:`, (e as Error).message);
    }
  }

  endRun(runId, errors === 0 ? "ok" : "partial", { drafted, skipped, errors });
  console.log(`\nDone. drafted=${drafted} skipped=${skipped} errors=${errors}`);
  console.log(`Review queue: http://localhost:3000/outreach/queue`);
} catch (e) {
  endRun(runId, "failed", { drafted, skipped, errors }, (e as Error).message);
  console.error("FATAL:", e);
  process.exit(1);
}
