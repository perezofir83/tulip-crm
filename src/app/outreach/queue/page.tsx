import Shell from "@/components/Shell";
import Link from "next/link";
import { one, all, run, audit } from "@/lib/db";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function OutreachQueue() {
  const drafts = await all<any>(
    `SELECT a.id, a.channel, a.step_number, a.subject, a.body, a.draft_url,
            a.drafted_by, a.created_at,
            c.id AS contact_id, c.full_name, c.title, c.is_welfare, c.linkedin_url,
            co.name_he AS company
     FROM outreach_attempts a
     JOIN contacts c ON c.id = a.contact_id
     JOIN companies co ON co.id = c.company_id
     WHERE a.state = 'drafted'
     ORDER BY c.is_welfare DESC, a.created_at DESC`
  );

  // Pending LinkedIn connects awaiting acceptance — checked automatically by cron
  const pendingConnects = await all<any>(
    `SELECT a.id, a.sent_at, a.sent_by,
            c.id AS contact_id, c.full_name, c.title, c.is_welfare, c.is_decision_maker,
            c.linkedin_url,
            co.name_he AS company, co.is_customer,
            CAST(julianday('now') - julianday(a.sent_at) AS INTEGER) AS days_since
     FROM outreach_attempts a
     JOIN contacts c ON c.id = a.contact_id
     JOIN companies co ON co.id = c.company_id
     WHERE a.channel = 'linkedin_connect_no_message'
       AND a.state = 'sent'
     ORDER BY a.sent_at DESC`
  );

  return (
    <Shell>
      <header className="flex items-end justify-between mb-6">
        <div>
          <h1 className="display text-3xl">תור פניות</h1>
          <p className="text-tulip-muted mt-1">
            {pendingConnects.length} חיבורים ממתינים לאישור · {drafts.length} דרפטים לאישור
          </p>
        </div>
        <div className="text-xs text-tulip-muted text-end max-w-xs">
          הסוכן בודק אוטומטית 3 פעמים ביום ומעדכן. את/ה רק קורא/ת ומאשר/ת.
        </div>
      </header>

      {pendingConnects.length > 0 && (
        <section className="mb-10">
          <h2 className="font-medium text-tulip-ink mb-3">📨 חיבורי LinkedIn ממתינים לאישור</h2>
          <div className="card divide-y divide-tulip-line">
            {pendingConnects.map((p) => (
              <div key={p.id} className="p-4 flex items-center justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <Link href={`/contacts/${p.contact_id}`} className="font-medium hover:text-tulip-wine">
                      {p.is_welfare ? "⭐ " : ""}{p.is_decision_maker ? "👔 " : ""}{p.full_name}
                    </Link>
                    <span className="text-tulip-muted text-sm">· {p.company} {p.is_customer ? "◆" : ""}</span>
                  </div>
                  {p.title && <div className="text-xs text-tulip-muted truncate">{p.title}</div>}
                </div>
                <div className="text-xs text-tulip-muted text-end shrink-0">
                  נשלח לפני {p.days_since === 0 ? "פחות מיממה" : `${p.days_since} ${p.days_since === 1 ? "יום" : "ימים"}`}
                  {p.sent_by && <div>על ידי {p.sent_by}</div>}
                </div>
                {p.linkedin_url && (
                  <a href={p.linkedin_url} target="_blank" rel="noreferrer" className="btn-ghost text-sm shrink-0">פתח</a>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      <h2 className="font-medium text-tulip-ink mb-3">✍️ דרפטים לאישור ושליחה</h2>

      {drafts.length === 0 ? (
        <div className="card p-12 text-center text-tulip-muted">
          <p className="mb-2">אין דרפטים בתור.</p>
          <p className="text-sm">הריצו <code className="bg-tulip-sand/40 px-2 py-1 rounded-sm">pnpm agent:daily</code> כדי לייצר.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {drafts.map((d) => (
            <article key={d.id} id={`a${d.id}`} className="card p-5">
              <header className="flex items-baseline justify-between gap-4 mb-3">
                <div>
                  <Link href={`/contacts/${d.contact_id}`} className="font-medium hover:text-tulip-wine">
                    {d.is_welfare ? "⭐ " : ""}{d.full_name}
                  </Link>
                  <span className="text-tulip-muted text-sm"> · {d.company}</span>
                  {d.title && <div className="text-xs text-tulip-muted mt-0.5">{d.title}</div>}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="chip">{d.channel}</span>
                  <span className="chip-muted">פנייה {d.step_number}</span>
                </div>
              </header>

              {d.subject && (
                <div className="mb-2 text-sm">
                  <span className="text-tulip-muted">נושא:</span> <strong>{d.subject}</strong>
                </div>
              )}
              <p className="text-sm whitespace-pre-wrap leading-relaxed bg-tulip-cream/60 p-3 rounded-sm border border-tulip-sand/40">
                {d.body}
              </p>

              <footer className="mt-3 flex flex-wrap items-center gap-2">
                <form action={markSent}>
                  <input type="hidden" name="attempt_id" value={d.id} />
                  <button className="btn-primary text-sm">סימון כנשלח</button>
                </form>
                {d.linkedin_url && (
                  <a href={d.linkedin_url} target="_blank" rel="noreferrer" className="btn-ghost text-sm">פתח LinkedIn של {d.full_name.split(" ")[0]}</a>
                )}
                {d.draft_url && (
                  <a href={d.draft_url} target="_blank" rel="noreferrer" className="btn-ghost text-sm">פתח דרפט שהוכן</a>
                )}
                <form action={discardDraft} className="ms-auto">
                  <input type="hidden" name="attempt_id" value={d.id} />
                  <button className="btn-link text-sm text-tulip-muted hover:text-tulip-wine">ביטול דרפט</button>
                </form>
              </footer>
            </article>
          ))}
        </div>
      )}
    </Shell>
  );
}

async function markSent(formData: FormData) {
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

async function discardDraft(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session.user_id) throw new Error("UNAUTHORIZED");
  const id = parseInt(String(formData.get("attempt_id")), 10);
  const a = await one("SELECT * FROM outreach_attempts WHERE id = ?", [id]);
  await run("UPDATE outreach_attempts SET state = 'failed', notes = 'discarded by user' WHERE id = ?", [id]);
  await audit(`user:${session.email}`, "outreach_attempts", id, "discard", a, null);
}
