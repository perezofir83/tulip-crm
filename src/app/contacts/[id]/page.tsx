import Shell from "@/components/Shell";
import Link from "next/link";
import { notFound } from "next/navigation";
import { one, all, run, audit } from "@/lib/db";
import { getSession } from "@/lib/auth";
import StatusBadge, { STATUS_OPTIONS } from "@/components/StatusBadge";

export const dynamic = "force-dynamic";

export default async function ContactDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id: idStr } = await params;
  const id = parseInt(idStr, 10);
  const c = await one<any>(
    `SELECT c.*, co.name_he AS company_name,
            co.is_customer AS company_is_customer,
            co.customer_email_count AS company_customer_emails,
            co.customer_units_total AS company_customer_units
     FROM contacts c
     JOIN companies co ON co.id = c.company_id WHERE c.id = ?`,
    [id]
  );
  if (!c) notFound();

  const attempts = await all<any>(
    `SELECT id, channel, step_number, subject, body, state, drafted_by, sent_by,
            sent_at, scheduled_at, draft_url, created_at
     FROM outreach_attempts WHERE contact_id = ? ORDER BY created_at DESC`,
    [id]
  );
  const replies = await all<any>(
    `SELECT id, channel, body, sentiment, intent, received_at, requires_attention
     FROM replies WHERE contact_id = ? ORDER BY received_at DESC`,
    [id]
  );

  return (
    <Shell>
      <Link href={`/companies/${c.company_id}`} className="btn-link text-sm">
        ← {c.company_name}
      </Link>
      {c.company_is_customer === 1 && (
        <div className="mt-3 mb-4 inline-flex items-center gap-2 border border-tulip-wine/30 bg-tulip-wine/5 text-tulip-wine px-3 py-1.5 rounded-sm text-xs">
          <span className="font-medium">◆ {c.company_name} — לקוח קיים</span>
          <span className="text-tulip-wine/70">
            ({c.company_customer_emails} מיילים בקובץ
            {c.company_customer_units > 0 && <>, {c.company_customer_units} מארזים</>})
          </span>
          <Link href={`/companies/${c.company_id}#customer-history`} className="underline ms-1">
            הצג היסטוריה
          </Link>
        </div>
      )}
      <header className="mt-4 mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="display text-3xl">
            {c.is_welfare ? "⭐ " : ""}{c.full_name}
          </h1>
          {c.title && <p className="text-tulip-muted mt-1">{c.title}</p>}
          {c.headline && (
            <p className="text-sm text-tulip-muted mt-2 max-w-2xl">{c.headline}</p>
          )}
        </div>
        <div className="text-end">
          <StatusBadge status={c.status} />
          <form action={changeStatus} className="mt-2 flex gap-2">
            <input type="hidden" name="contact_id" value={c.id} />
            <select name="status" defaultValue={c.status} className="input text-sm py-1">
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <button className="btn-ghost text-sm">עדכון</button>
          </form>
        </div>
      </header>

      <div className="grid md:grid-cols-3 gap-6 mb-8">
        <section className="card p-5 space-y-2 text-sm">
          <h2 className="label">סושיאל וערוצים</h2>
          {c.linkedin_url && <a href={c.linkedin_url} target="_blank" rel="noreferrer" className="block btn-link break-all">LinkedIn</a>}
          {c.email && <a href={`mailto:${c.email}`} className="block btn-link">{c.email}</a>}
          {c.phone && <a href={`tel:${c.phone}`} className="block btn-link">{c.phone}</a>}
          {c.twitter_url && <a href={c.twitter_url} target="_blank" rel="noreferrer" className="block btn-link">X / Twitter</a>}
          {c.facebook_url && <a href={c.facebook_url} target="_blank" rel="noreferrer" className="block btn-link">Facebook</a>}
          {!c.linkedin_url && !c.email && !c.phone && (
            <p className="text-tulip-muted">אין פרטים — </p>
          )}
        </section>

        <section className="card p-5 text-sm">
          <h2 className="label">סיגנלים חמים</h2>
          {c.last_linkedin_post_at && (
            <p><span className="text-tulip-muted">פוסט LinkedIn אחרון:</span> {c.last_linkedin_post_at}</p>
          )}
          {c.last_linkedin_post_excerpt && (
            <p className="text-tulip-ink/80 italic mt-1">"{c.last_linkedin_post_excerpt}"</p>
          )}
          {c.last_twitter_at && (
            <p className="mt-2"><span className="text-tulip-muted">פוסט X אחרון:</span> {c.last_twitter_at}</p>
          )}
          {!c.last_linkedin_post_at && !c.last_twitter_at && (
            <p className="text-tulip-muted">לא נאספו עדיין. הסוכן יעדכן בריצה הבאה.</p>
          )}
        </section>

        <section className="card p-5 text-sm">
          <h2 className="label">היסטוריה</h2>
          <p><span className="text-tulip-muted">פנייה אחרונה:</span> {c.last_touch_at || "—"}</p>
          <p><span className="text-tulip-muted">מענה אחרון מהליד:</span> {c.last_inbound_at || "—"}</p>
          <p><span className="text-tulip-muted">פעולה הבאה:</span> {c.next_action_at || "—"}</p>
        </section>
      </div>

      <section className="card p-6 mb-6">
        <header className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-medium text-tulip-forest">פניות יוצאות ({attempts.length})</h2>
          <Link href={`/outreach/compose?contact=${id}`} className="btn-ghost text-sm">+ פנייה ידנית</Link>
        </header>

        <ol className="space-y-4">
          {attempts.map((a) => (
            <li key={a.id} id={`a${a.id}`} className="border border-tulip-sand/60 rounded-sm p-4 bg-tulip-cream/40">
              <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
                <div className="flex items-center gap-2">
                  <span className="chip">{a.channel}</span>
                  <span className="chip-muted">פנייה {a.step_number}</span>
                  <span className={a.state === "sent" ? "chip-forest" : a.state === "drafted" ? "chip" : "chip-wine"}>
                    {a.state === "drafted" ? "דרפט" : a.state === "sent" ? "נשלח" : a.state}
                  </span>
                </div>
                <span className="text-xs text-tulip-muted">
                  {a.sent_at || a.created_at}
                </span>
              </div>
              {a.subject && <div className="font-medium mb-1">{a.subject}</div>}
              <p className="text-sm whitespace-pre-wrap leading-relaxed">{a.body}</p>
              {a.state === "drafted" && (
                <form action={approveAndSend} className="mt-3 flex gap-2">
                  <input type="hidden" name="attempt_id" value={a.id} />
                  <button className="btn-primary text-xs">סימון כנשלח</button>
                  {a.draft_url && (
                    <a href={a.draft_url} target="_blank" rel="noreferrer" className="btn-ghost text-xs">פתיחה ב-LinkedIn</a>
                  )}
                </form>
              )}
            </li>
          ))}
          {attempts.length === 0 && (
            <p className="text-sm text-tulip-muted">אין פניות עדיין.</p>
          )}
        </ol>
      </section>

      <section className="card p-6">
        <h2 className="text-lg font-medium text-tulip-forest mb-4">תגובות נכנסות ({replies.length})</h2>
        <ul className="space-y-3">
          {replies.map((r) => (
            <li key={r.id} className="border-r-2 border-tulip-wine ps-4 pe-2 py-2">
              <div className="flex items-baseline justify-between text-xs text-tulip-muted">
                <span>{r.channel} · {r.received_at}</span>
                {r.sentiment && <span className="chip-muted">{r.sentiment}</span>}
              </div>
              <p className="text-sm mt-1 whitespace-pre-wrap">{r.body}</p>
            </li>
          ))}
          {replies.length === 0 && <p className="text-sm text-tulip-muted">אין תגובות עדיין.</p>}
        </ul>
      </section>
    </Shell>
  );
}

// ---------- server actions ----------

async function changeStatus(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session.user_id) throw new Error("UNAUTHORIZED");
  const id = parseInt(String(formData.get("contact_id")), 10);
  const status = String(formData.get("status"));
  const before = await one("SELECT status FROM contacts WHERE id = ?", [id]);
  await run(
    `UPDATE contacts SET status = ?, updated_at = datetime('now') WHERE id = ?`,
    [status, id]
  );
  await audit(`user:${session.email}`, "contacts", id, "status_change", before, { status });
}

async function approveAndSend(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session.user_id) throw new Error("UNAUTHORIZED");
  const id = parseInt(String(formData.get("attempt_id")), 10);
  const a = await one<any>("SELECT * FROM outreach_attempts WHERE id = ?", [id]);
  if (!a) return;
  await run(
    `UPDATE outreach_attempts
       SET state = 'sent', sent_by = ?, sent_at = datetime('now'), updated_at = datetime('now')
     WHERE id = ?`,
    [`user:${session.email}`, id]
  );
  const next =
    a.channel === "linkedin_invite" ? "linkedin_invited" :
    a.channel === "linkedin_dm"     ? "conversation" :
    a.channel === "email" && a.step_number === 1 ? "email_sent" :
    a.channel === "email"           ? `followup_${a.step_number - 1}` :
    "queued";
  await run(
    `UPDATE contacts SET status = ?, last_touch_at = datetime('now'), updated_at = datetime('now')
     WHERE id = ?`,
    [next, a.contact_id]
  );
  await audit(`user:${session.email}`, "outreach_attempts", id, "mark_sent", a, { state: "sent" });
}
