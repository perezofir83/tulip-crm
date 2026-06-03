import Shell from "@/components/Shell";
import Link from "next/link";
import { revalidatePath } from "next/cache";
import { one, all, run, audit } from "@/lib/db";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function OutreachQueue() {
  // 🚨 PRIORITY 1 — Unattended replies (most urgent: someone is waiting on you)
  const replies = await all<any>(
    `SELECT r.id, r.body, r.sentiment, r.intent, r.received_at, r.attempt_id,
            c.id AS contact_id, c.full_name, c.title, c.is_welfare, c.linkedin_url,
            co.name_he AS company, co.is_customer
     FROM replies r
     JOIN contacts c ON c.id = r.contact_id
     JOIN companies co ON co.id = c.company_id
     WHERE r.requires_attention = 1 AND r.attended_at IS NULL
     ORDER BY r.received_at DESC`
  );

  // 🟧 PRIORITY 2 — Drafts ready to send (you need to copy-paste to LinkedIn)
  // Sorted: welfare > decision-maker > customer > recency
  const drafts = await all<any>(
    `SELECT a.id, a.channel, a.step_number, a.subject, a.body, a.draft_url,
            a.drafted_by, a.created_at,
            c.id AS contact_id, c.full_name, c.title, c.is_welfare, c.is_decision_maker, c.linkedin_url,
            co.name_he AS company, co.is_customer
     FROM outreach_attempts a
     JOIN contacts c ON c.id = a.contact_id
     JOIN companies co ON co.id = c.company_id
     WHERE a.state = 'drafted'
     ORDER BY c.is_welfare DESC, c.is_decision_maker DESC, co.is_customer DESC, a.created_at DESC`
  );

  // 🔵 PRIORITY 3 — Pending connects (passive: waiting on them)
  // Sorted by oldest first (closer to 14-day expiry = more urgent)
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
     ORDER BY a.sent_at ASC`
  );

  // ✅ Recently sent (informational — what you sent today)
  const recentlySent = await all<any>(
    `SELECT a.id, a.sent_at, a.body, a.channel,
            c.id AS contact_id, c.full_name, c.is_welfare,
            co.name_he AS company
     FROM outreach_attempts a
     JOIN contacts c ON c.id = a.contact_id
     JOIN companies co ON co.id = c.company_id
     WHERE a.channel IN ('linkedin_message', 'linkedin_connect_note', 'linkedin_dm')
       AND a.state = 'sent'
       AND a.sent_at > datetime('now', '-3 days')
     ORDER BY a.sent_at DESC
     LIMIT 40`
  );

  return (
    <Shell>
      <header className="flex items-end justify-between mb-6">
        <div>
          <h1 className="display text-3xl">תור פניות</h1>
          <p className="text-tulip-muted mt-1 text-sm">
            {replies.length > 0 && <span className="text-tulip-wine font-medium">🚨 {replies.length} תגובות לטיפול · </span>}
            {drafts.length} דרפטים לשליחה · {pendingConnects.length} ממתינים לאישור · {recentlySent.length} נשלחו לאחרונה
          </p>
        </div>
        <div className="text-xs text-tulip-muted text-end max-w-xs">
          ממוין מהדחוף לחומר רקע: תגובות → דרפטים → ממתינים → היסטוריה.<br />
          הסוכן בודק אוטומטית 3 פעמים ביום.
        </div>
      </header>

      {/* 🚨 P1: REPLIES — most urgent */}
      {replies.length > 0 && (
        <section className="mb-10">
          <h2 className="font-medium text-tulip-wine mb-3">🚨 תגובות שלא טופלו</h2>
          <div className="space-y-3">
            {replies.map((r) => (
              <article key={r.id} className="card p-4 border-l-4 border-tulip-wine">
                <header className="flex items-baseline justify-between gap-3 mb-2">
                  <div>
                    <Link href={`/contacts/${r.contact_id}`} className="font-medium hover:text-tulip-wine">
                      {r.is_welfare ? "⭐ " : ""}{r.full_name}
                    </Link>
                    <span className="text-tulip-muted text-sm"> · {r.company} {r.is_customer ? "◆" : ""}</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {r.intent && <span className="chip-forest">{r.intent}</span>}
                    {r.sentiment && <span className="chip-muted">{r.sentiment}</span>}
                  </div>
                </header>
                <p className="text-sm whitespace-pre-wrap leading-relaxed bg-tulip-cream/60 p-3 rounded-sm border border-tulip-sand/40">
                  {r.body}
                </p>
                <footer className="mt-2 text-xs text-tulip-muted flex justify-between">
                  <span>נכנס {r.received_at}</span>
                  {r.linkedin_url && (
                    <a href={r.linkedin_url} target="_blank" rel="noreferrer" className="hover:text-tulip-wine">פתח LinkedIn</a>
                  )}
                </footer>
              </article>
            ))}
          </div>
        </section>
      )}

      {/* 🟧 P2: DRAFTS — you need to send */}
      <section className="mb-10">
        <h2 className="font-medium text-tulip-ink mb-3">✍️ דרפטים לשליחה ({drafts.length})</h2>
        {drafts.length === 0 ? (
          <div className="card p-8 text-center text-tulip-muted text-sm">
            אין דרפטים בתור כרגע.
          </div>
        ) : (
          <div className="space-y-4">
            {drafts.map((d) => (
              <article key={d.id} id={`a${d.id}`} className="card p-5">
                <header className="flex items-baseline justify-between gap-4 mb-3">
                  <div>
                    <Link href={`/contacts/${d.contact_id}`} className="font-medium hover:text-tulip-wine">
                      {d.is_welfare ? "⭐ " : ""}{d.is_decision_maker ? "👔 " : ""}{d.full_name}
                    </Link>
                    <span className="text-tulip-muted text-sm"> · {d.company} {d.is_customer ? "◆" : ""}</span>
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
      </section>

      {/* 🔵 P3: PENDING CONNECTS — passive */}
      {pendingConnects.length > 0 && (
        <section className="mb-10">
          <h2 className="font-medium text-tulip-ink mb-3">📨 ממתינים לאישור חיבור ({pendingConnects.length})</h2>
          <div className="card divide-y divide-tulip-line">
            {pendingConnects.map((p) => {
              const isUrgent = p.days_since >= 10;
              return (
                <div key={p.id} className="p-3 flex items-center justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <Link href={`/contacts/${p.contact_id}`} className="text-sm hover:text-tulip-wine">
                        {p.is_welfare ? "⭐ " : ""}{p.is_decision_maker ? "👔 " : ""}{p.full_name}
                      </Link>
                      <span className="text-tulip-muted text-xs">· {p.company} {p.is_customer ? "◆" : ""}</span>
                    </div>
                  </div>
                  <div className={`text-xs text-end shrink-0 ${isUrgent ? "text-tulip-wine font-medium" : "text-tulip-muted"}`}>
                    {p.days_since === 0 ? "היום" : `${p.days_since} ${p.days_since === 1 ? "יום" : "ימים"}`}
                  </div>
                  {p.linkedin_url && (
                    <a href={p.linkedin_url} target="_blank" rel="noreferrer" className="text-xs text-tulip-muted hover:text-tulip-wine shrink-0">פתח</a>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ✅ P4: Recently sent — read-only */}
      {recentlySent.length > 0 && (
        <section className="mb-6">
          <h2 className="font-medium text-tulip-muted mb-3 text-sm">✅ נשלחו לאחרונה ({recentlySent.length})</h2>
          <div className="card divide-y divide-tulip-line opacity-80">
            {recentlySent.map((s) => (
              <div key={s.id} className="p-3 flex items-center justify-between gap-3 text-sm">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="chip-forest shrink-0">
                    {s.channel === "linkedin_connect_note" ? "הזמנה+פתק" : s.channel === "linkedin_message" ? "הודעה" : s.channel}
                  </span>
                  <Link href={`/contacts/${s.contact_id}`} className="hover:text-tulip-wine truncate">
                    {s.is_welfare ? "⭐ " : ""}{s.full_name}
                  </Link>
                  <span className="text-tulip-muted text-xs truncate"> · {s.company}</span>
                </div>
                <span className="text-xs text-tulip-muted shrink-0">{s.sent_at}</span>
              </div>
            ))}
          </div>
        </section>
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
    a.channel === "linkedin_message" ? "conversation_started" :
    a.channel === "linkedin_connect_note" ? "contacted" :
    a.channel === "email" && a.step_number === 1 ? "email_sent" :
    a.channel === "email"           ? `followup_${a.step_number - 1}` :
    "queued";
  await run(
    `UPDATE contacts SET status = ?, last_touch_at = datetime('now'), updated_at = datetime('now')
     WHERE id = ?`,
    [next, a.contact_id]
  );
  await audit(`user:${session.email}`, "outreach_attempts", id, "mark_sent", a, { state: "sent" });
  revalidatePath("/outreach/queue");
  revalidatePath("/outreach");
}

async function discardDraft(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session.user_id) throw new Error("UNAUTHORIZED");
  const id = parseInt(String(formData.get("attempt_id")), 10);
  const a = await one("SELECT * FROM outreach_attempts WHERE id = ?", [id]);
  await run("UPDATE outreach_attempts SET state = 'failed', notes = 'discarded by user' WHERE id = ?", [id]);
  await audit(`user:${session.email}`, "outreach_attempts", id, "discard", a, null);
  revalidatePath("/outreach/queue");
  revalidatePath("/outreach");
}
