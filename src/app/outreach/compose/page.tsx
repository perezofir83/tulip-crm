import Shell from "@/components/Shell";
import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { one, all, run, audit } from "@/lib/db";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function ComposePage({
  searchParams,
}: {
  searchParams: Promise<{ contact?: string }>;
}) {
  const sp = await searchParams;
  const contactId = sp.contact ? parseInt(sp.contact, 10) : null;
  if (!contactId) notFound();

  const c = await one<any>(
    `SELECT c.*, co.name_he AS company_name
     FROM contacts c JOIN companies co ON co.id = c.company_id
     WHERE c.id = ?`,
    [contactId]
  );
  if (!c) notFound();

  const lastAttempt = await one<{ s: number | null }>(
    "SELECT MAX(step_number) AS s FROM outreach_attempts WHERE contact_id = ?",
    [contactId]
  );
  const nextStep = (lastAttempt?.s || 0) + 1;

  const templates = await all<any>(
    "SELECT slug, channel, step_number, subject, body FROM templates WHERE is_active = 1"
  );

  return (
    <Shell>
      <Link href={`/contacts/${contactId}`} className="btn-link text-sm">← {c.full_name}</Link>
      <h1 className="display text-3xl mt-3 mb-2">פנייה ידנית</h1>
      <p className="text-tulip-muted mb-8">
        {c.full_name} <span className="mx-2">·</span> {c.company_name}
        <span className="mx-2">·</span> פנייה מס׳ {nextStep}
      </p>

      <form action={createAttempt} className="card p-6 space-y-5 max-w-3xl">
        <input type="hidden" name="contact_id" value={contactId} />
        <input type="hidden" name="step_number" value={nextStep} />

        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <label className="label">ערוץ</label>
            <select name="channel" required className="input" defaultValue="linkedin_dm">
              <option value="linkedin_invite">LinkedIn — בקשת חברות</option>
              <option value="linkedin_dm">LinkedIn — הודעה</option>
              <option value="email">מייל</option>
              <option value="phone">שיחת טלפון</option>
              <option value="manual">אחר</option>
            </select>
          </div>
          <div>
            <label className="label">טמפלט (אופציונלי, יציע טקסט)</label>
            <select name="template_slug" className="input">
              <option value="">— ללא —</option>
              {templates.map((t) => (
                <option key={t.slug} value={t.slug}>{t.slug} ({t.channel})</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="label">נושא (למייל בלבד)</label>
          <input name="subject" className="input" />
        </div>

        <div>
          <label className="label">תוכן הפנייה *</label>
          <textarea name="body" required rows={10} className="input font-sans leading-relaxed" placeholder={`היי ${c.full_name.split(/\s+/)[0]},\n\n…`} />
          <p className="text-xs text-tulip-muted mt-1">תמיכה ב-{`{{first_name}}, {{company}}`} (יוחלפו אוטומטית).</p>
        </div>

        <div>
          <label className="label">draft URL (לטאב LinkedIn פתוח, אופציונלי)</label>
          <input name="draft_url" type="url" className="input" placeholder="https://www.linkedin.com/in/…" />
        </div>

        <div className="flex gap-2 pt-2">
          <button type="submit" name="state" value="drafted" className="btn-ghost">שמירה כדרפט</button>
          <button type="submit" name="state" value="sent" className="btn-primary">סימון כנשלח</button>
          <Link href={`/contacts/${contactId}`} className="btn-link text-sm ms-auto">ביטול</Link>
        </div>
      </form>
    </Shell>
  );
}

async function createAttempt(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session.user_id) throw new Error("UNAUTHORIZED");

  const contact_id = parseInt(String(formData.get("contact_id")), 10);
  const channel = String(formData.get("channel"));
  const step_number = parseInt(String(formData.get("step_number")), 10);
  const subject = String(formData.get("subject") || "").trim() || null;
  const body = String(formData.get("body") || "").trim();
  const draft_url = String(formData.get("draft_url") || "").trim() || null;
  const state = String(formData.get("state") || "drafted");
  const template_slug = String(formData.get("template_slug") || "").trim() || null;

  if (!body) throw new Error("empty body");

  const c = await one<any>("SELECT full_name, company_id FROM contacts WHERE id = ?", [contact_id]);
  const co = await one<any>("SELECT name_he FROM companies WHERE id = ?", [c.company_id]);

  // basic variable substitution
  const firstName = c.full_name.split(/\s+/)[0];
  const rendered = body
    .replace(/\{\{first_name\}\}/g, firstName)
    .replace(/\{\{name\}\}/g, c.full_name)
    .replace(/\{\{company\}\}/g, co.name_he);

  const tplRow = template_slug
    ? await one<{ id: number }>("SELECT id FROM templates WHERE slug = ?", [template_slug])
    : null;
  const tplId = tplRow?.id ?? null;

  const info = await run(
    `INSERT INTO outreach_attempts
       (contact_id, channel, step_number, template_id, subject, body, state,
        drafted_by, sent_by, sent_at, draft_url)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      contact_id, channel, step_number, tplId,
      subject, rendered, state,
      `user:${session.email}`,
      state === "sent" ? `user:${session.email}` : null,
      state === "sent" ? new Date().toISOString() : null,
      draft_url,
    ]
  );
  const newId = Number(info.lastInsertRowid);

  if (state === "sent") {
    const nextStatus =
      channel === "linkedin_invite" ? "linkedin_invited" :
      channel === "linkedin_dm" ? "conversation" :
      channel === "email" && step_number === 1 ? "email_sent" :
      channel === "email" ? `followup_${step_number - 1}` :
      "queued";
    await run(
      `UPDATE contacts SET status = ?, last_touch_at = datetime('now'), updated_at = datetime('now')
       WHERE id = ?`,
      [nextStatus, contact_id]
    );
  }
  await audit(`user:${session.email}`, "outreach_attempts", newId, "insert", null, {
    contact_id, channel, step_number, state,
  });

  redirect(`/contacts/${contact_id}#a${newId}`);
}
