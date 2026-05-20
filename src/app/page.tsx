import Shell from "@/components/Shell";
import Link from "next/link";
import { one, all } from "@/lib/db";

export const dynamic = "force-dynamic";

function num(n: number) {
  return new Intl.NumberFormat("he-IL").format(n);
}
function ils(n: number) {
  return new Intl.NumberFormat("he-IL", { style: "currency", currency: "ILS", maximumFractionDigits: 0 }).format(n);
}

export default async function DashboardPage() {
  const stats = (await one<any>(
    `SELECT
      (SELECT COUNT(*) FROM companies) AS total_cos,
      (SELECT COUNT(*) FROM companies WHERE linkedin_url IS NOT NULL AND linkedin_url != '') AS cos_with_linkedin,
      (SELECT COUNT(*) FROM companies WHERE is_customer = 1) AS existing_customers,
      (SELECT COUNT(*) FROM contacts) AS total_contacts,
      (SELECT COUNT(*) FROM contacts WHERE is_welfare = 1) AS welfare_contacts,
      (SELECT COUNT(*) FROM outreach_attempts WHERE state = 'drafted') AS pending_drafts,
      (SELECT COUNT(*) FROM outreach_attempts WHERE state = 'sent') AS total_sent,
      (SELECT COUNT(DISTINCT contact_id) FROM replies) AS replied_contacts,
      (SELECT COUNT(*) FROM replies WHERE requires_attention = 1) AS unread_replies,
      (SELECT COUNT(*) FROM deals WHERE stage = 'won') AS deals_won,
      (SELECT COALESCE(SUM(units),0) FROM deals WHERE stage = 'won') AS units_won,
      (SELECT COALESCE(SUM(total_ils),0) FROM deals WHERE stage = 'won') AS revenue_won,
      (SELECT COUNT(*) FROM kb_objections) AS kb_entries`
  )) || ({} as any);

  const replyRate =
    stats.total_sent > 0 ? (stats.replied_contacts / stats.total_sent) * 100 : 0;

  const recentDrafts = await all<any>(
    `SELECT a.id, a.channel, a.body, a.created_at,
            c.full_name, c.id AS contact_id, co.name_he AS company
     FROM outreach_attempts a
     JOIN contacts c ON c.id = a.contact_id
     JOIN companies co ON co.id = c.company_id
     WHERE a.state = 'drafted'
     ORDER BY a.created_at DESC
     LIMIT 5`
  );

  const topWelfare = await all<any>(
    `SELECT c.id, c.full_name, c.title, co.name_he AS company
     FROM contacts c JOIN companies co ON co.id = c.company_id
     WHERE c.is_welfare = 1
     ORDER BY c.updated_at DESC LIMIT 8`
  );

  return (
    <Shell>
      <h1 className="display text-3xl mb-2">דשבורד</h1>
      <p className="text-tulip-muted mb-8">סקירה כללית · {new Date().toLocaleDateString("he-IL", { weekday: "long", day: "numeric", month: "long" })}</p>

      {/* KPI grid */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-10">
        <Kpi label="חברות בצינור" value={num(stats.total_cos)} sub={`${num(stats.cos_with_linkedin)} עם LinkedIn · ${num(stats.existing_customers)} ◆ לקוחות`} />
        <Kpi label="אנשי קשר" value={num(stats.total_contacts)} sub={`${num(stats.welfare_contacts)} ⭐ רווחה/EE`} />
        <Kpi label="פניות נשלחו" value={num(stats.total_sent)} sub={`${num(stats.pending_drafts)} דרפטים ממתינים`} />
        <Kpi label="אחוז מענה" value={`${replyRate.toFixed(1)}%`} sub={`${num(stats.replied_contacts)} ענו`} />
        <Kpi label="עסקאות סגורות" value={num(stats.deals_won)} sub={`${num(stats.units_won)} מארזים`} />
        <Kpi label="הכנסה מצטברת" value={ils(stats.revenue_won || 0)} sub="מתחילת הקמפיין" />
        <Kpi label="התנגדויות במאגר" value={num(stats.kb_entries)} sub="לומדות בכל פנייה" />
        <Kpi label="מענים בהמתנה" value={num(stats.unread_replies)} sub="דורש התייחסות" highlight={stats.unread_replies > 0} />
      </section>

      <div className="grid md:grid-cols-2 gap-6">
        <section className="card p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-medium text-tulip-forest">דרפטים אחרונים</h2>
            <Link href="/outreach/queue" className="btn-link text-sm">לכל התור ←</Link>
          </div>
          {recentDrafts.length === 0 ? (
            <p className="text-sm text-tulip-muted">אין דרפטים. הריצו <code>pnpm agent:daily</code>.</p>
          ) : (
            <ul className="space-y-3">
              {recentDrafts.map((d) => (
                <li key={d.id} className="border-b border-tulip-sand/60 pb-3 last:border-0">
                  <Link href={`/outreach/queue#a${d.id}`} className="block hover:bg-tulip-cream/60 -mx-2 px-2 py-1 rounded-sm">
                    <div className="flex justify-between items-start gap-3">
                      <div>
                        <div className="font-medium">{d.full_name}</div>
                        <div className="text-sm text-tulip-muted">{d.company}</div>
                      </div>
                      <span className="chip-muted shrink-0">{d.channel}</span>
                    </div>
                    <p className="text-sm text-tulip-ink/80 mt-1 line-clamp-2 leading-relaxed">{d.body}</p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-medium text-tulip-forest">לידים ⭐ רווחה / EE</h2>
            <Link href="/contacts?tag=welfare_EE" className="btn-link text-sm">לכל הרשימה ←</Link>
          </div>
          <ul className="space-y-2">
            {topWelfare.map((c) => (
              <li key={c.id}>
                <Link href={`/contacts/${c.id}`} className="flex items-baseline justify-between hover:bg-tulip-cream/60 -mx-2 px-2 py-1.5 rounded-sm">
                  <div>
                    <div className="font-medium">{c.full_name}</div>
                    <div className="text-xs text-tulip-muted">{c.title}</div>
                  </div>
                  <div className="text-sm text-tulip-muted">{c.company}</div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </Shell>
  );
}

function Kpi({ label, value, sub, highlight }: { label: string; value: string; sub?: string; highlight?: boolean }) {
  return (
    <div className={`card p-5 ${highlight ? "ring-1 ring-tulip-wine" : ""}`}>
      <div className="stat-lbl">{label}</div>
      <div className={`stat-num mt-1 ${highlight ? "text-tulip-wine" : ""}`}>{value}</div>
      {sub && <div className="text-xs text-tulip-muted mt-1">{sub}</div>}
    </div>
  );
}
