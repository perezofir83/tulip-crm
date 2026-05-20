/**
 * Reply-checker — runs every 5 hours. Polls LinkedIn DMs + Gmail for inbound
 * messages from known contacts, ingests them as `replies`, and raises
 * notifications when human attention is needed.
 *
 * STATUS: stub. Polling integrations to wire later:
 *   - LinkedIn: Playwright browser session (same persisted profile as draft agent)
 *   - Gmail: gws CLI (already available) or Gmail API directly
 *
 * Manual usage today: from the UI, open any contact → paste a reply you saw
 * elsewhere into the "תגובות נכנסות" section (TODO: add manual-add form).
 *
 * Cron suggestion:
 *   every 5 hours -> pnpm tsx scripts/agent-reply-check.ts
 *   (or LaunchAgent on macOS)
 */
import { beginRun, endRun, ingestReply } from "../src/lib/agents";

const AGENT_ID = "reply-checker-v1";

async function main() {
  const runId = beginRun(AGENT_ID, { polled_at: new Date().toISOString() });
  try {
    // TODO Gmail: pull last 5h of inbound for contacts.email
    // TODO LinkedIn: open /messaging?filter=unread, parse threads
    // For each new reply found → ingestReply(...)
    // Example shape:
    // ingestReply({
    //   contact_id: 123,
    //   channel: "linkedin",
    //   body: "...",
    //   received_at: new Date().toISOString(),
    //   sentiment: "interested",
    // });
    endRun(runId, "ok", { new_replies: 0, channels_polled: [] });
    console.log("✅ reply-check complete (stub — integrations not wired)");
  } catch (e) {
    endRun(runId, "failed", null, (e as Error).message);
    throw e;
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
