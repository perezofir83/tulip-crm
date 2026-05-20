import Shell from "@/components/Shell";
import Link from "next/link";
import { one, all } from "@/lib/db";
import StatusBadge from "@/components/StatusBadge";

export const dynamic = "force-dynamic";

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; tag?: string; status?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const q = sp.q?.trim() || "";
  const tag = sp.tag || "";
  const status = sp.status || "";
  const page = parseInt(sp.page || "1", 10);
  const pageSize = 60;

  const where: string[] = [];
  const params: any[] = [];
  if (q) {
    where.push(`(c.full_name LIKE ? OR c.title LIKE ? OR co.name_he LIKE ?)`);
    const like = `%${q}%`; params.push(like, like, like);
  }
  if (tag === "welfare_EE") where.push(`c.is_welfare = 1`);
  if (tag === "existing_customers") where.push(`co.is_customer = 1`);
  if (tag === "new_prospects") where.push(`co.is_customer = 0`);
  if (status) { where.push(`c.status = ?`); params.push(status); }
  const whereSql = where.length ? "WHERE " + where.join(" AND ") : "";

  const total = (await one<{ c: number }>(
    `SELECT COUNT(*) AS c FROM contacts c JOIN companies co ON co.id = c.company_id ${whereSql}`,
    params
  ))?.c ?? 0;

  const rows = await all<any>(
    `SELECT c.id, c.full_name, c.title, c.role_tag, c.is_welfare, c.status,
            c.linkedin_url, c.email, c.last_touch_at, c.last_inbound_at,
            co.id AS company_id, co.name_he AS company,
            co.is_customer AS company_is_customer
     FROM contacts c JOIN companies co ON co.id = c.company_id
     ${whereSql}
     ORDER BY co.is_customer DESC, c.is_welfare DESC, c.updated_at DESC
     LIMIT ? OFFSET ?`,
    [...params, pageSize, (page - 1) * pageSize]
  );

  return (
    <Shell>
      <header className="flex items-end justify-between mb-6">
        <div>
          <h1 className="display text-3xl">אנשי קשר</h1>
          <p className="text-tulip-muted mt-1">{total.toLocaleString("he-IL")} אנשי קשר</p>
        </div>
      </header>

      <form className="card p-4 mb-6 grid md:grid-cols-4 gap-3">
        <input name="q" defaultValue={q} placeholder="חיפוש לפי שם / תפקיד / חברה" className="input md:col-span-2" />
        <select name="tag" defaultValue={tag} className="input">
          <option value="">תיוג — הכל</option>
          <option value="existing_customers">◆ בחברה לקוח קיים</option>
          <option value="new_prospects">○ ליד חדש (חברה לא לקוח)</option>
          <option value="welfare_EE">⭐ רווחה / EE בלבד</option>
        </select>
        <select name="status" defaultValue={status} className="input">
          <option value="">סטטוס — הכל</option>
          <option value="new">חדש</option>
          <option value="linkedin_invited">נשלחה פנייה LinkedIn</option>
          <option value="email_sent">נשלח מייל</option>
          <option value="conversation">בשיחה</option>
          <option value="meeting_set">פגישה</option>
          <option value="won">נסגרה</option>
        </select>
        <div className="md:col-span-4 flex gap-2">
          <button className="btn-primary text-sm">סינון</button>
          <Link href="/contacts" className="btn-ghost text-sm">איפוס</Link>
        </div>
      </form>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-tulip-cream border-b border-tulip-sand">
            <tr>
              <th className="px-4 py-3 table-head">שם</th>
              <th className="px-4 py-3 table-head">חברה</th>
              <th className="px-4 py-3 table-head">תפקיד</th>
              <th className="px-4 py-3 table-head">סטטוס</th>
              <th className="px-4 py-3 table-head">פנייה אחרונה</th>
              <th className="px-4 py-3 table-head">ערוץ</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-tulip-sand/40 hover:bg-tulip-cream/60">
                <td className="px-4 py-3">
                  <Link href={`/contacts/${r.id}`} className="font-medium hover:text-tulip-wine">
                    {r.is_welfare ? "⭐ " : ""}{r.full_name}
                  </Link>
                </td>
                <td className="px-4 py-3">
                  <Link href={`/companies/${r.company_id}`} className="text-tulip-muted hover:text-tulip-wine">
                    {r.company}
                  </Link>
                  {r.company_is_customer === 1 && (
                    <span className="chip-wine ms-2 text-[10px]">◆ לקוח</span>
                  )}
                </td>
                <td className="px-4 py-3 text-tulip-muted line-clamp-1 max-w-xs">{r.title || "—"}</td>
                <td className="px-4 py-3"><StatusBadge status={r.status} /></td>
                <td className="px-4 py-3 text-xs text-tulip-muted">{r.last_touch_at || "—"}</td>
                <td className="px-4 py-3 text-xs">
                  {r.linkedin_url && <a href={r.linkedin_url} target="_blank" rel="noreferrer" className="btn-link">LinkedIn</a>}
                  {r.email && <span className="ms-2 text-tulip-muted">{r.email}</span>}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-12 text-center text-tulip-muted">לא נמצאו אנשי קשר.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </Shell>
  );
}
