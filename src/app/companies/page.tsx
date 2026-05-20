import Shell from "@/components/Shell";
import Link from "next/link";
import { one, all } from "@/lib/db";

export const dynamic = "force-dynamic";

type Row = {
  id: number;
  name_he: string;
  category: string | null;
  description: string | null;
  location: string | null;
  emp_count: number | null;
  business_alive: string | null;
  linkedin_url: string | null;
  twitter_url: string | null;
  facebook_url: string | null;
  is_customer: number;
  customer_email_count: number;
  customer_units_total: number;
  contacts: number;
  welfare: number;
};

export default async function CompaniesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; alive?: string; tag?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const q = sp.q?.trim() || "";
  const alive = sp.alive || "";
  const tag = sp.tag || "";
  const page = parseInt(sp.page || "1", 10);
  const pageSize = 50;

  const where: string[] = [];
  const params: any[] = [];
  if (q) {
    where.push(`(co.name_he LIKE ? OR co.description LIKE ? OR co.category LIKE ?)`);
    const like = `%${q}%`;
    params.push(like, like, like);
  }
  if (alive) {
    where.push(`co.business_alive = ?`);
    params.push(alive);
  }
  if (tag === "welfare_EE") {
    where.push(
      `EXISTS (SELECT 1 FROM contacts c WHERE c.company_id = co.id AND c.is_welfare = 1)`
    );
  } else if (tag === "with_hr") {
    where.push(
      `EXISTS (SELECT 1 FROM contacts c WHERE c.company_id = co.id)`
    );
  } else if (tag === "with_linkedin") {
    where.push(`co.linkedin_url IS NOT NULL AND co.linkedin_url != ''`);
  } else if (tag === "existing_customers") {
    where.push(`co.is_customer = 1`);
  } else if (tag === "new_prospects") {
    where.push(`co.is_customer = 0`);
  }
  const whereSql = where.length ? "WHERE " + where.join(" AND ") : "";

  const totalRow = await one<{ c: number }>(
    `SELECT COUNT(*) AS c FROM companies co ${whereSql}`,
    params
  );
  const total = totalRow?.c ?? 0;

  const rows = await all<Row>(
    `SELECT co.id, co.name_he, co.category, co.description, co.location,
            co.emp_count, co.business_alive, co.linkedin_url, co.twitter_url, co.facebook_url,
            co.is_customer, co.customer_email_count, co.customer_units_total,
            (SELECT COUNT(*) FROM contacts c WHERE c.company_id = co.id) AS contacts,
            (SELECT COUNT(*) FROM contacts c WHERE c.company_id = co.id AND c.is_welfare = 1) AS welfare
     FROM companies co
     ${whereSql}
     ORDER BY co.is_customer DESC, welfare DESC, contacts DESC, co.name_he
     LIMIT ? OFFSET ?`,
    [...params, pageSize, (page - 1) * pageSize]
  );

  const customerCount = (await one<{ c: number }>(
    "SELECT COUNT(*) AS c FROM companies WHERE is_customer = 1"
  ))?.c ?? 0;
  const newProspectCount = (await one<{ c: number }>(
    "SELECT COUNT(*) AS c FROM companies WHERE is_customer = 0"
  ))?.c ?? 0;

  return (
    <Shell>
      <header className="flex items-end justify-between mb-6 gap-4">
        <div>
          <h1 className="display text-3xl">חברות</h1>
          <p className="text-tulip-muted mt-1">
            {total.toLocaleString("he-IL")} חברות בצינור
            <span className="mx-2">·</span>
            <Link href="/companies?tag=existing_customers" className="text-tulip-wine hover:underline">
              ◆ {customerCount.toLocaleString("he-IL")} לקוחות קיימים
            </Link>
            <span className="mx-2">·</span>
            <Link href="/companies?tag=new_prospects" className="hover:underline">
              ○ {newProspectCount.toLocaleString("he-IL")} לידים חדשים
            </Link>
          </p>
        </div>
        <Link href="/companies/new" className="btn-ghost text-sm">+ הוספה ידנית</Link>
      </header>

      <form className="card p-4 mb-6 grid md:grid-cols-4 gap-3">
        <input
          name="q"
          defaultValue={q}
          placeholder="חיפוש לפי שם / קטגוריה / תיאור"
          className="input md:col-span-2"
        />
        <select name="alive" defaultValue={alive} className="input">
          <option value="">סטטוס פעילות — הכל</option>
          <option value="yes">פעיל (yes)</option>
          <option value="probably">סביר</option>
          <option value="uncertain">לא ברור</option>
          <option value="no">לא פעיל</option>
        </select>
        <select name="tag" defaultValue={tag} className="input">
          <option value="">סינון — הכל</option>
          <option value="existing_customers">◆ לקוחות קיימים</option>
          <option value="new_prospects">○ לידים חדשים (לא לקוחות)</option>
          <option value="welfare_EE">⭐ עם איש רווחה/EE</option>
          <option value="with_hr">עם איש HR</option>
          <option value="with_linkedin">עם LinkedIn URL</option>
        </select>
        <div className="md:col-span-4 flex gap-2">
          <button className="btn-primary text-sm">סינון</button>
          <Link href="/companies" className="btn-ghost text-sm">איפוס</Link>
        </div>
      </form>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-tulip-cream border-b border-tulip-sand">
            <tr>
              <th className="px-4 py-3 table-head">שם</th>
              <th className="px-4 py-3 table-head">קטגוריה</th>
              <th className="px-4 py-3 table-head">מיקום</th>
              <th className="px-4 py-3 table-head">עובדים</th>
              <th className="px-4 py-3 table-head">פעיל</th>
              <th className="px-4 py-3 table-head">אנשי קשר</th>
              <th className="px-4 py-3 table-head">סושיאל</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-tulip-sand/40 hover:bg-tulip-cream/60">
                <td className="px-4 py-3">
                  <Link href={`/companies/${r.id}`} className="font-medium text-tulip-ink hover:text-tulip-wine">
                    {r.name_he}
                  </Link>
                  {r.is_customer === 1 && (
                    <span className="chip-wine ms-2" title={`${r.customer_email_count} מיילים בקובץ הלקוחות`}>
                      ◆ לקוח קיים{r.customer_email_count > 1 ? ` · ${r.customer_email_count} מיילים` : ""}
                    </span>
                  )}
                  {r.description && (
                    <div className="text-xs text-tulip-muted line-clamp-1">{r.description}</div>
                  )}
                </td>
                <td className="px-4 py-3 text-tulip-muted">{r.category || "—"}</td>
                <td className="px-4 py-3 text-tulip-muted">{r.location || "—"}</td>
                <td className="px-4 py-3 tabular-nums">{r.emp_count?.toLocaleString("he-IL") || "—"}</td>
                <td className="px-4 py-3">
                  {r.business_alive ? <AliveChip v={r.business_alive} /> : <span className="text-tulip-muted">—</span>}
                </td>
                <td className="px-4 py-3 tabular-nums">
                  {r.contacts}
                  {r.welfare > 0 && <span className="chip-wine ms-2">⭐ {r.welfare}</span>}
                </td>
                <td className="px-4 py-3">
                  <Socials li={r.linkedin_url} tw={r.twitter_url} fb={r.facebook_url} />
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-12 text-center text-tulip-muted">לא נמצאו חברות.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {total > pageSize && (
        <nav className="flex justify-between items-center mt-4 text-sm">
          <span className="text-tulip-muted">
            עמוד {page} מתוך {Math.ceil(total / pageSize)}
          </span>
          <div className="flex gap-2">
            {page > 1 && (
              <Link href={`?${new URLSearchParams({ ...sp, page: String(page - 1) })}`} className="btn-ghost text-sm">
                הקודם
              </Link>
            )}
            {page * pageSize < total && (
              <Link href={`?${new URLSearchParams({ ...sp, page: String(page + 1) })}`} className="btn-ghost text-sm">
                הבא
              </Link>
            )}
          </div>
        </nav>
      )}
    </Shell>
  );
}

function AliveChip({ v }: { v: string }) {
  const map: Record<string, string> = {
    yes: "chip-forest",
    probably: "chip",
    uncertain: "chip-muted",
    no: "chip-wine",
  };
  return <span className={map[v] || "chip"}>{v}</span>;
}

function Socials({ li, tw, fb }: { li?: string | null; tw?: string | null; fb?: string | null }) {
  return (
    <div className="flex gap-2 text-xs">
      {li && <a href={li} target="_blank" rel="noreferrer" className="btn-link">LinkedIn</a>}
      {tw && <a href={tw} target="_blank" rel="noreferrer" className="btn-link">X</a>}
      {fb && <a href={fb} target="_blank" rel="noreferrer" className="btn-link">FB</a>}
      {!li && !tw && !fb && <span className="text-tulip-muted">—</span>}
    </div>
  );
}
