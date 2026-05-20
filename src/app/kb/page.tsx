import Shell from "@/components/Shell";
import { one, all, run, audit } from "@/lib/db";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function KBPage({ searchParams }: { searchParams: Promise<{ q?: string; cat?: string }> }) {
  const sp = await searchParams;
  const q = sp.q?.trim() || "";
  const cat = sp.cat || "";

  const where: string[] = [];
  const params: any[] = [];
  if (q) { where.push("(objection_text LIKE ? OR tulip_response LIKE ?)"); params.push(`%${q}%`, `%${q}%`); }
  if (cat) { where.push("category = ?"); params.push(cat); }
  const whereSql = where.length ? "WHERE " + where.join(" AND ") : "";

  const items = await all<any>(
    `SELECT id, objection_text, category, tulip_response, tulip_response_source,
            seen_count, last_seen_at, outcome_won, outcome_lost, is_approved
     FROM kb_objections ${whereSql}
     ORDER BY seen_count DESC, last_seen_at DESC`,
    params
  );

  const categories = await all<{ category: string }>(
    "SELECT DISTINCT category FROM kb_objections WHERE category IS NOT NULL"
  );

  return (
    <Shell>
      <header className="mb-6">
        <h1 className="display text-3xl">פירוק התנגדויות</h1>
        <p className="text-tulip-muted mt-1">
          המאגר לומד מכל תגובה של ליד. כשהסוכן מנסח פנייה — הוא משתמש בתשובות המאושרות.
        </p>
      </header>

      <form method="get" action="/kb" className="card p-4 mb-6 grid md:grid-cols-3 gap-3">
        <input name="q" defaultValue={q} placeholder="חיפוש בהתנגדויות / תשובות" className="input md:col-span-2" />
        <select name="cat" defaultValue={cat} className="input">
          <option value="">קטגוריה — הכל</option>
          {categories.map((c) => c.category && (
            <option key={c.category} value={c.category}>{c.category}</option>
          ))}
        </select>
        <div className="md:col-span-3">
          <button className="btn-primary text-sm">חיפוש</button>
        </div>
      </form>

      <div className="space-y-4">
        {items.map((k) => (
          <article key={k.id} className="card p-5">
            <header className="flex items-baseline justify-between gap-3 mb-3">
              <div className="flex items-center gap-2">
                {k.category && <span className="chip">{k.category}</span>}
                <span className="chip-muted">נראתה {k.seen_count}×</span>
                {!k.is_approved && <span className="chip-wine">ממתין לאישור</span>}
                {k.outcome_won > 0 && <span className="chip-forest">סגרה {k.outcome_won} עסקה</span>}
              </div>
              <span className="text-xs text-tulip-muted">{k.last_seen_at}</span>
            </header>

            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <div className="label">ההתנגדות</div>
                <p className="text-sm whitespace-pre-wrap leading-relaxed">{k.objection_text}</p>
              </div>

              <div>
                <div className="label">תשובת טוליפ</div>
                <form action={updateKB}>
                  <input type="hidden" name="id" value={k.id} />
                  <textarea name="tulip_response" defaultValue={k.tulip_response || ""} rows={4} className="input text-sm" placeholder="ניסוח התשובה שאנחנו רוצים שהסוכן ישתמש בה" />
                  <div className="flex items-center gap-2 mt-2">
                    <select name="category" defaultValue={k.category || ""} className="input text-sm">
                      <option value="">קטגוריה</option>
                      <option value="price">מחיר</option>
                      <option value="timing">תזמון</option>
                      <option value="not-decision-maker">לא קובע</option>
                      <option value="competitor">מתחרה</option>
                      <option value="quality">איכות</option>
                      <option value="not-interested">לא רלוונטי</option>
                      <option value="other">אחר</option>
                    </select>
                    <label className="text-sm flex items-center gap-1">
                      <input type="checkbox" name="is_approved" defaultChecked={!!k.is_approved} value="1" />
                      אישור לסוכן
                    </label>
                    <button className="btn-ghost text-sm ms-auto">שמירה</button>
                  </div>
                </form>
              </div>
            </div>
          </article>
        ))}
        {items.length === 0 && (
          <p className="card p-12 text-center text-tulip-muted">עדיין אין התנגדויות במאגר. הן יתווספו אוטומטית עם כל תגובת ליד.</p>
        )}
      </div>
    </Shell>
  );
}

async function updateKB(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session.user_id) throw new Error("UNAUTHORIZED");
  const id = parseInt(String(formData.get("id")), 10);
  const tulip_response = String(formData.get("tulip_response") || "") || null;
  const category = String(formData.get("category") || "") || null;
  const is_approved = formData.get("is_approved") ? 1 : 0;
  const before = await one("SELECT * FROM kb_objections WHERE id = ?", [id]);
  await run(
    `UPDATE kb_objections
       SET tulip_response = ?, category = ?, is_approved = ?, tulip_response_source = 'user_provided', updated_at = datetime('now')
     WHERE id = ?`,
    [tulip_response, category, is_approved, id]
  );
  await audit(`user:${session.email}`, "kb_objections", id, "update", before, { tulip_response, category, is_approved });
}
