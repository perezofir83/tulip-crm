import Shell from "@/components/Shell";
import Link from "next/link";
import { redirect } from "next/navigation";
import { one, run, audit } from "@/lib/db";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default function NewCompanyPage() {
  return (
    <Shell>
      <Link href="/companies" className="btn-link text-sm">← חברות</Link>
      <h1 className="display text-3xl mt-3 mb-8">חברה חדשה</h1>

      <form action={createCompany} className="card p-6 space-y-5 max-w-2xl">
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <label className="label">שם בעברית *</label>
            <input name="name_he" required className="input" />
          </div>
          <div>
            <label className="label">קטגוריה</label>
            <input name="category" className="input" placeholder="בנקאות / היי-טק / קמעונאות …" />
          </div>
        </div>

        <div>
          <label className="label">תיאור (מה החברה עושה)</label>
          <textarea name="description" rows={3} className="input" />
        </div>

        <div className="grid md:grid-cols-3 gap-4">
          <div>
            <label className="label">מיקום</label>
            <input name="location" className="input" />
          </div>
          <div>
            <label className="label">מספר עובדים</label>
            <input name="emp_count" type="number" className="input" />
          </div>
          <div>
            <label className="label">פעילות</label>
            <select name="business_alive" defaultValue="yes" className="input">
              <option value="yes">פעיל</option>
              <option value="probably">סביר</option>
              <option value="uncertain">לא ברור</option>
              <option value="no">לא פעיל</option>
            </select>
          </div>
        </div>

        <div className="divider"></div>

        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <label className="label">אתר אינטרנט</label>
            <input name="website" type="url" className="input" />
          </div>
          <div>
            <label className="label">LinkedIn URL</label>
            <input name="linkedin_url" type="url" className="input" placeholder="https://www.linkedin.com/company/…/" />
          </div>
          <div>
            <label className="label">X / Twitter</label>
            <input name="twitter_url" type="url" className="input" />
          </div>
          <div>
            <label className="label">Facebook</label>
            <input name="facebook_url" type="url" className="input" />
          </div>
        </div>

        <div>
          <label className="label">מיילים ציבוריים (מופרדים בפסיק)</label>
          <input name="public_emails" className="input" />
        </div>

        <div>
          <label className="label">הערות</label>
          <textarea name="notes" rows={3} className="input" />
        </div>

        <div className="flex gap-2 pt-2">
          <button type="submit" className="btn-primary">שמירה</button>
          <Link href="/companies" className="btn-ghost">ביטול</Link>
        </div>
      </form>
    </Shell>
  );
}

async function createCompany(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session.user_id) throw new Error("UNAUTHORIZED");

  const name_he = String(formData.get("name_he") || "").trim();
  if (!name_he) throw new Error("missing name");

  // Auto-assign next cid (matches Google-Sheet convention so future imports don't collide)
  const m = await one<{ m: number }>("SELECT COALESCE(MAX(id), 0) AS m FROM companies");
  const newId = (m?.m ?? 0) + 1;

  const data = {
    id: newId,
    name_he,
    category: String(formData.get("category") || "").trim() || null,
    description: String(formData.get("description") || "").trim() || null,
    location: String(formData.get("location") || "").trim() || null,
    emp_count: parseInt(String(formData.get("emp_count") || ""), 10) || null,
    business_alive: String(formData.get("business_alive") || "yes"),
    website: String(formData.get("website") || "").trim() || null,
    linkedin_url: String(formData.get("linkedin_url") || "").trim() || null,
    twitter_url: String(formData.get("twitter_url") || "").trim() || null,
    facebook_url: String(formData.get("facebook_url") || "").trim() || null,
    public_emails: String(formData.get("public_emails") || "").trim() || null,
    notes: String(formData.get("notes") || "").trim() || null,
  };

  await run(
    `INSERT INTO companies
       (id, name_he, category, description, location, emp_count, business_alive,
        website, linkedin_url, twitter_url, facebook_url, public_emails, notes, scraped_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    [data.id, data.name_he, data.category, data.description, data.location, data.emp_count,
     data.business_alive, data.website, data.linkedin_url, data.twitter_url, data.facebook_url,
     data.public_emails, data.notes]
  );
  await audit(`user:${session.email}`, "companies", newId, "insert", null, data);

  redirect(`/companies/${newId}`);
}
