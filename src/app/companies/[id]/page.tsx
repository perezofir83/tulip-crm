import Shell from "@/components/Shell";
import Link from "next/link";
import { notFound } from "next/navigation";
import { one, all } from "@/lib/db";
import StatusBadge from "@/components/StatusBadge";

export const dynamic = "force-dynamic";

export default async function CompanyDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id: idStr } = await params;
  const id = parseInt(idStr, 10);
  const co = await one<any>("SELECT * FROM companies WHERE id = ?", [id]);
  if (!co) notFound();

  const contacts = await all<any>(
    `SELECT id, full_name, title, role_tag, is_welfare, linkedin_url, email, status,
            last_touch_at, last_inbound_at
     FROM contacts WHERE company_id = ? ORDER BY is_welfare DESC, full_name`,
    [id]
  );

  // Historical customers from the May-2026 xlsx import
  const customers = await all<any>(
    `SELECT id, email, first_name, last_name, phone, city,
            units_purchased, budget_range, notes, status, created_at_source, match_method
     FROM existing_customers WHERE company_id = ?
     ORDER BY created_at_source DESC`,
    [id]
  );

  return (
    <Shell>
      <Link href="/companies" className="btn-link text-sm">← לרשימת חברות</Link>
      <header className="mt-4 mb-8">
        <div className="flex items-baseline gap-3 flex-wrap">
          <h1 className="display text-3xl">{co.name_he}</h1>
          {co.is_customer === 1 && (
            <span className="chip-wine">◆ לקוח קיים</span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 mt-2 text-sm text-tulip-muted">
          {co.category && <span className="chip-muted">{co.category}</span>}
          {co.location && <span>{co.location}</span>}
          {co.emp_count && <span>· {co.emp_count.toLocaleString("he-IL")} עובדים</span>}
          {co.business_alive && <span>· {co.business_alive}</span>}
        </div>
      </header>

      {co.is_customer === 1 && (
        <section className="card border-tulip-wine/30 bg-tulip-wine/5 p-5 mb-6">
          <div className="flex items-baseline justify-between gap-4 mb-3">
            <h2 className="font-medium text-tulip-wine">היסטוריית קשר עם הלקוח</h2>
            <div className="text-xs text-tulip-muted">
              {co.customer_email_count} מיילים בקובץ
              {co.customer_units_total > 0 && <> · {co.customer_units_total} מארזים נרכשו</>}
            </div>
          </div>
          <p className="text-sm text-tulip-ink/80 mb-3">
            חברה זו נמצאת ברשימת הלקוחות שלנו (מארזי שי וקבוצות, מאי 2026).
            לפני יצירת קשר חדש — מומלץ לבדוק היסטוריה.
          </p>
          {customers.length > 0 && (
            <details className="text-sm">
              <summary className="cursor-pointer text-tulip-wine hover:underline">
                הצגת {customers.length} רשומות לקוח
              </summary>
              <table className="w-full text-xs mt-3 border-t border-tulip-wine/20">
                <thead>
                  <tr className="text-tulip-muted">
                    <th className="py-2 px-2 text-right font-medium">שם</th>
                    <th className="py-2 px-2 text-right font-medium">אימייל</th>
                    <th className="py-2 px-2 text-right font-medium">טלפון</th>
                    <th className="py-2 px-2 text-right font-medium">תאריך</th>
                    <th className="py-2 px-2 text-right font-medium">מארזים</th>
                    <th className="py-2 px-2 text-right font-medium">הערות</th>
                  </tr>
                </thead>
                <tbody>
                  {customers.map((cu) => (
                    <tr key={cu.id} className="border-t border-tulip-wine/10">
                      <td className="py-2 px-2">{[cu.first_name, cu.last_name].filter(Boolean).join(" ") || "—"}</td>
                      <td className="py-2 px-2 text-tulip-muted">{cu.email || "—"}</td>
                      <td className="py-2 px-2 text-tulip-muted">{cu.phone || "—"}</td>
                      <td className="py-2 px-2 text-tulip-muted">{cu.created_at_source || "—"}</td>
                      <td className="py-2 px-2 tabular-nums">{cu.units_purchased || "—"}</td>
                      <td className="py-2 px-2 text-tulip-muted max-w-xs truncate" title={cu.notes || ""}>{cu.notes || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}
        </section>
      )}

      <div className="grid md:grid-cols-3 gap-6 mb-8">
        <div className="md:col-span-2 card p-6">
          <h2 className="font-medium text-tulip-forest mb-3">תיאור</h2>
          <p className="text-sm leading-relaxed">{co.description || <em className="text-tulip-muted">אין תיאור</em>}</p>
          {co.notes && (
            <>
              <h3 className="font-medium text-tulip-forest mt-6 mb-2">הערות</h3>
              <p className="text-sm whitespace-pre-line">{co.notes}</p>
            </>
          )}
        </div>

        <div className="card p-6 space-y-3 text-sm">
          <h2 className="font-medium text-tulip-forest mb-1">קישורים</h2>
          {co.website && (
            <a href={co.website} target="_blank" rel="noreferrer" className="block btn-link break-all">
              {co.website}
            </a>
          )}
          {co.linkedin_url && (
            <a href={co.linkedin_url} target="_blank" rel="noreferrer" className="block btn-link break-all">
              LinkedIn ({co.linkedin_followers ? `${co.linkedin_followers.toLocaleString("he-IL")} עוקבים` : "—"})
            </a>
          )}
          {co.twitter_url && (
            <a href={co.twitter_url} target="_blank" rel="noreferrer" className="block btn-link">X / Twitter</a>
          )}
          {co.facebook_url && (
            <a href={co.facebook_url} target="_blank" rel="noreferrer" className="block btn-link">Facebook</a>
          )}
          {co.public_emails && (
            <div>
              <div className="label">מיילים ציבוריים</div>
              <div className="text-tulip-ink">{co.public_emails}</div>
            </div>
          )}
        </div>
      </div>

      <section className="card overflow-hidden">
        <header className="px-6 py-4 border-b border-tulip-sand flex items-center justify-between">
          <h2 className="font-medium text-tulip-forest">אנשי קשר ({contacts.length})</h2>
          <Link href={`/contacts/new?company_id=${id}`} className="btn-ghost text-sm">+ איש קשר חדש</Link>
        </header>
        <table className="w-full text-sm">
          <thead className="bg-tulip-cream/60">
            <tr>
              <th className="px-4 py-2 table-head">שם</th>
              <th className="px-4 py-2 table-head">תפקיד</th>
              <th className="px-4 py-2 table-head">סטטוס</th>
              <th className="px-4 py-2 table-head">פנייה אחרונה</th>
              <th className="px-4 py-2 table-head">מענה אחרון</th>
              <th className="px-4 py-2 table-head">סושיאל</th>
            </tr>
          </thead>
          <tbody>
            {contacts.map((c) => (
              <tr key={c.id} className="border-t border-tulip-sand/40 hover:bg-tulip-cream/60">
                <td className="px-4 py-3">
                  <Link href={`/contacts/${c.id}`} className="font-medium hover:text-tulip-wine">
                    {c.is_welfare ? "⭐ " : ""}{c.full_name}
                  </Link>
                </td>
                <td className="px-4 py-3 text-tulip-muted">{c.title || "—"}</td>
                <td className="px-4 py-3"><StatusBadge status={c.status} /></td>
                <td className="px-4 py-3 text-tulip-muted text-xs">{c.last_touch_at || "—"}</td>
                <td className="px-4 py-3 text-tulip-muted text-xs">{c.last_inbound_at || "—"}</td>
                <td className="px-4 py-3 text-xs">
                  {c.linkedin_url && <a href={c.linkedin_url} target="_blank" rel="noreferrer" className="btn-link">LinkedIn</a>}
                  {c.email && <span className="ms-2">{c.email}</span>}
                </td>
              </tr>
            ))}
            {contacts.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-tulip-muted">
                  אין אנשי קשר. <Link href={`/contacts/new?company_id=${id}`} className="btn-link">הוסף חדש</Link>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </Shell>
  );
}
