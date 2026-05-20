import Shell from "@/components/Shell";
import Link from "next/link";
import { redirect } from "next/navigation";
import { one, all, run, audit } from "@/lib/db";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function NewContactPage({
  searchParams,
}: {
  searchParams: Promise<{ company_id?: string }>;
}) {
  const sp = await searchParams;
  const preselectId = sp.company_id ? parseInt(sp.company_id, 10) : null;

  const company = preselectId
    ? await one<{ id: number; name_he: string }>(
        "SELECT id, name_he FROM companies WHERE id = ?",
        [preselectId]
      )
    : null;

  // companies list for the dropdown (small enough to render inline)
  const companies = await all<{ id: number; name_he: string }>(
    "SELECT id, name_he FROM companies ORDER BY name_he LIMIT 3000"
  );

  return (
    <Shell>
      <Link href={company ? `/companies/${company.id}` : "/contacts"} className="btn-link text-sm">
        ← {company ? company.name_he : "אנשי קשר"}
      </Link>
      <h1 className="display text-3xl mt-3 mb-8">איש קשר חדש</h1>

      <form action={createContact} className="card p-6 space-y-5 max-w-2xl">
        <div>
          <label className="label">חברה *</label>
          <select name="company_id" required defaultValue={preselectId || ""} className="input">
            <option value="">— בחר/י חברה —</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>{c.name_he}</option>
            ))}
          </select>
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <label className="label">שם מלא *</label>
            <input name="full_name" required className="input" />
          </div>
          <div>
            <label className="label">תפקיד</label>
            <input name="title" className="input" placeholder="VP HR / מנהלת רווחה / וכו'" />
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <label className="label">תיוג תפקיד</label>
            <select name="role_tag" className="input">
              <option value="">—</option>
              <option value="welfare_EE">⭐ Welfare / Employee Experience</option>
              <option value="CHRO">CHRO</option>
              <option value="CPO">CPO</option>
              <option value="VP_HR">VP HR</option>
              <option value="Head_HR">Head of HR</option>
              <option value="HRBP">HRBP</option>
              <option value="TA">Talent Acquisition</option>
              <option value="CEO">CEO</option>
              <option value="other">אחר</option>
            </select>
          </div>
          <div>
            <label className="label">דגל ⭐ רווחה</label>
            <label className="flex items-center gap-2 mt-2.5">
              <input type="checkbox" name="is_welfare" value="1" />
              <span className="text-sm">סמן כאיש רווחה / EE (יעד Tulip)</span>
            </label>
          </div>
        </div>

        <div className="divider"></div>

        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <label className="label">LinkedIn URL</label>
            <input name="linkedin_url" type="url" className="input" placeholder="https://www.linkedin.com/in/…" />
          </div>
          <div>
            <label className="label">אימייל</label>
            <input name="email" type="email" className="input" />
          </div>
          <div>
            <label className="label">טלפון</label>
            <input name="phone" type="tel" className="input" />
          </div>
          <div>
            <label className="label">X / Twitter URL</label>
            <input name="twitter_url" type="url" className="input" />
          </div>
        </div>

        <div>
          <label className="label">הערות</label>
          <textarea name="notes" rows={3} className="input" />
        </div>

        <div className="flex gap-2 pt-2">
          <button type="submit" className="btn-primary">שמירה</button>
          <Link href={company ? `/companies/${company.id}` : "/contacts"} className="btn-ghost">ביטול</Link>
        </div>
      </form>
    </Shell>
  );
}

async function createContact(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session.user_id) throw new Error("UNAUTHORIZED");

  const company_id = parseInt(String(formData.get("company_id")), 10);
  const full_name = String(formData.get("full_name") || "").trim();
  if (!company_id || !full_name) throw new Error("missing required fields");

  const data = {
    company_id,
    full_name,
    title: String(formData.get("title") || "").trim() || null,
    role_tag: String(formData.get("role_tag") || "").trim() || null,
    is_welfare: formData.get("is_welfare") ? 1 : 0,
    linkedin_url: String(formData.get("linkedin_url") || "").trim() || null,
    email: String(formData.get("email") || "").trim() || null,
    phone: String(formData.get("phone") || "").trim() || null,
    twitter_url: String(formData.get("twitter_url") || "").trim() || null,
    notes: String(formData.get("notes") || "").trim() || null,
  };

  const info = await run(
    `INSERT INTO contacts
       (company_id, full_name, title, role_tag, is_welfare,
        linkedin_url, email, phone, twitter_url, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [data.company_id, data.full_name, data.title, data.role_tag, data.is_welfare,
     data.linkedin_url, data.email, data.phone, data.twitter_url, data.notes]
  );
  const newId = Number(info.lastInsertRowid);
  await audit(`user:${session.email}`, "contacts", newId, "insert", null, data);

  redirect(`/contacts/${newId}`);
}
