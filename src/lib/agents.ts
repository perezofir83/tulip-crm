/**
 * Agent library — pure async functions the agent scripts call.
 * Browser automation (Playwright) lives in scripts/agent-*.ts.
 *
 * Design: agents NEVER send messages. They only:
 *   1. pick contacts to work on
 *   2. enrich freshness signals (recent LinkedIn/Twitter activity)
 *   3. render templates → draft outreach_attempts (state='drafted')
 *   4. detect inbound replies → log + create notifications
 *
 * The human user reviews & sends from the UI. Sent attempts get state='sent'.
 */
import { one, all, run, audit } from "./db";

export type DailyPickInput = {
  budget?: number;
  prefer_role_tag?: string;
};

export type PickedContact = {
  contact_id: number;
  full_name: string;
  company_id: number;
  company: string;
  role_tag: string | null;
  is_welfare: boolean;
  linkedin_url: string | null;
  current_step: number;
  next_channel: string;
  template_slug: string;
};

export async function pickDailyBatch(input: DailyPickInput = {}): Promise<PickedContact[]> {
  const budget = Math.min(Math.max(input.budget ?? 25, 1), 50);

  const rows = await all<any>(
    `
    WITH last_touch AS (
      SELECT contact_id, MAX(created_at) AS last_at, MAX(step_number) AS last_step
      FROM outreach_attempts GROUP BY contact_id
    )
    SELECT
      c.id AS contact_id, c.full_name, c.company_id, c.role_tag,
      c.is_welfare, c.linkedin_url, c.status,
      co.name_he AS company,
      COALESCE(lt.last_step, 0) AS last_step,
      lt.last_at
    FROM contacts c
    JOIN companies co ON co.id = c.company_id
    LEFT JOIN last_touch lt ON lt.contact_id = c.id
    WHERE c.status IN ('new', 'queued', 'linkedin_invited', 'email_sent')
      AND (lt.last_at IS NULL OR julianday('now') - julianday(lt.last_at) >= 3)
    ORDER BY
      c.is_welfare DESC,
      CASE c.role_tag
        WHEN 'welfare_EE' THEN 0
        WHEN 'CHRO' THEN 1
        WHEN 'CPO' THEN 1
        WHEN 'VP_HR' THEN 2
        WHEN 'Head_HR' THEN 3
        WHEN 'HRBP' THEN 4
        ELSE 5
      END,
      c.full_name
    LIMIT ?
    `,
    [budget * 3]
  );

  const picked: PickedContact[] = [];
  for (const r of rows) {
    if (picked.length >= budget) break;
    const currentStep = r.last_step as number;
    let next_channel: string;
    let template_slug: string;
    if (currentStep === 0) {
      if (r.linkedin_url) {
        next_channel = "linkedin_invite";
        template_slug = "linkedin_invite_v1";
      } else {
        next_channel = "email";
        template_slug = "email_opener_v1";
      }
    } else if (currentStep === 1 && r.status === "linkedin_invited") {
      next_channel = "linkedin_dm";
      template_slug = "linkedin_dm_followup_1";
    } else if (currentStep === 1) {
      next_channel = "email";
      template_slug = "email_followup_1";
    } else {
      continue;
    }
    picked.push({
      contact_id: r.contact_id,
      full_name: r.full_name,
      company_id: r.company_id,
      company: r.company,
      role_tag: r.role_tag,
      is_welfare: !!r.is_welfare,
      linkedin_url: r.linkedin_url,
      current_step: currentStep,
      next_channel,
      template_slug,
    });
  }
  return picked;
}

export function renderTemplate(
  body: string,
  vars: Record<string, string | undefined>
): string {
  return body.replace(/\{\{(\w+)\}\}/g, (_, key) =>
    (vars[key] ?? `{{${key}}}`).toString()
  );
}

export type DraftInput = {
  agent_id: string;
  run_id: number;
  contact_id: number;
  channel: string;
  step_number: number;
  template_slug: string;
  rendered_body: string;
  subject?: string | null;
  draft_url?: string | null;
};

export async function createDraft(input: DraftInput): Promise<number> {
  const tpl = await one<{ id: number }>(
    "SELECT id FROM templates WHERE slug = ?",
    [input.template_slug]
  );

  const info = await run(
    `INSERT INTO outreach_attempts
       (contact_id, channel, step_number, template_id, subject, body,
        state, drafted_by, draft_url)
     VALUES (?, ?, ?, ?, ?, ?, 'drafted', ?, ?)`,
    [
      input.contact_id, input.channel, input.step_number,
      tpl?.id ?? null,
      input.subject ?? null, input.rendered_body,
      `agent:${input.agent_id}`,
      input.draft_url ?? null,
    ]
  );
  const attemptId = Number(info.lastInsertRowid);

  await run(
    `INSERT INTO agent_events (run_id, contact_id, event_type, payload_json)
     VALUES (?, ?, 'drafted_message', ?)`,
    [input.run_id, input.contact_id, JSON.stringify({ attempt_id: attemptId, channel: input.channel })]
  );
  await run(
    `INSERT INTO notifications (kind, contact_id, title, body, url)
     VALUES ('approval_needed', ?, ?, ?, ?)`,
    [input.contact_id,
      `דרפט מוכן לאישור: ${input.channel}`,
      input.rendered_body.slice(0, 200),
      `/outreach/review?attempt=${attemptId}`]
  );
  await audit(`agent:${input.agent_id}`, "outreach_attempts", attemptId, "insert", null, input);
  return attemptId;
}

export async function beginRun(agent_id: string, input_json: unknown): Promise<number> {
  const info = await run(
    "INSERT INTO agent_runs (agent_id, input_json) VALUES (?, ?)",
    [agent_id, JSON.stringify(input_json)]
  );
  return Number(info.lastInsertRowid);
}

export async function endRun(
  run_id: number,
  status: "ok" | "partial" | "failed",
  summary: unknown,
  error?: string
): Promise<void> {
  await run(
    `UPDATE agent_runs
       SET finished_at = datetime('now'), status = ?, summary_json = ?, error = ?
     WHERE id = ?`,
    [status, JSON.stringify(summary), error ?? null, run_id]
  );
}

/* ---------- Inbound reply handling + KB learning ---------- */

const STOP_WORDS = new Set([
  "the","a","an","and","or","but","is","are","was","were","be","i","you","we",
  "to","of","in","on","at","for","with","by","this","that","it","as","not","no",
  "אני","אתה","אנחנו","היא","הוא","זה","לא","כן","אבל","עם","של","על","את","ב",
]);

export function fingerprintObjection(text: string): string {
  const tokens = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOP_WORDS.has(t));
  return Array.from(new Set(tokens)).sort().join(" ");
}

export type IngestReplyInput = {
  contact_id: number;
  channel: string;
  body: string;
  received_at: string;
  attempt_id?: number;
  sentiment?: string | null;
  intent?: string | null;
};

export async function ingestReply(r: IngestReplyInput): Promise<number> {
  const info = await run(
    `INSERT INTO replies
       (contact_id, attempt_id, channel, body, sentiment, intent, received_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [r.contact_id, r.attempt_id ?? null, r.channel, r.body,
     r.sentiment ?? null, r.intent ?? null, r.received_at]
  );
  const replyId = Number(info.lastInsertRowid);

  // KB dedup: match on objection_key
  const key = fingerprintObjection(r.body);
  const existing = await one<{ id: number }>(
    "SELECT id FROM kb_objections WHERE objection_key = ?",
    [key]
  );

  if (existing) {
    await run(
      `UPDATE kb_objections
         SET seen_count = seen_count + 1, last_seen_at = datetime('now')
       WHERE id = ?`,
      [existing.id]
    );
    await run(
      `INSERT INTO kb_reply_links (reply_id, objection_id, similarity)
       VALUES (?, ?, 1.0)`,
      [replyId, existing.id]
    );
  } else {
    const k = await run(
      `INSERT INTO kb_objections (objection_key, objection_text, tulip_response_source)
       VALUES (?, ?, 'agent_suggested')`,
      [key, r.body.slice(0, 500)]
    );
    await run(
      `INSERT INTO kb_reply_links (reply_id, objection_id, similarity)
       VALUES (?, ?, 1.0)`,
      [replyId, Number(k.lastInsertRowid)]
    );
  }

  await run(
    `UPDATE contacts SET last_inbound_at = ?, updated_at = datetime('now')
     WHERE id = ?`,
    [r.received_at, r.contact_id]
  );

  const contact = await one<{ full_name: string }>(
    "SELECT full_name FROM contacts WHERE id = ?", [r.contact_id]
  );
  await run(
    `INSERT INTO notifications (kind, contact_id, title, body, url)
     VALUES ('reply', ?, ?, ?, ?)`,
    [r.contact_id,
     `תגובה חדשה — ${contact?.full_name ?? ""}`,
     r.body.slice(0, 200),
     `/contacts/${r.contact_id}`]
  );

  await audit("agent:reply-checker", "replies", replyId, "insert", null, r);
  return replyId;
}
