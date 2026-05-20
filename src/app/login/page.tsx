import { redirect } from "next/navigation";
import Image from "next/image";
import { login } from "@/lib/auth";

export const dynamic = "force-dynamic";

async function doLogin(formData: FormData) {
  "use server";
  const email = String(formData.get("email") || "");
  const password = String(formData.get("password") || "");
  const next = String(formData.get("next") || "/");
  const res = await login(email, password);
  if (res.ok) redirect(next);
  redirect(`/login?error=${encodeURIComponent(res.error)}&next=${encodeURIComponent(next)}`);
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const sp = await searchParams;
  return (
    <div className="min-h-screen flex items-center justify-center bg-tulip-paper px-6">
      <div className="w-full max-w-sm">
        <div className="text-center mb-12">
          <Image
            src="/brand/tulip-full.svg"
            alt="Tulip Winery"
            width={140}
            height={140}
            priority
            className="mx-auto"
          />
          <div className="brandmark text-[10px] text-tulip-muted mt-3">
            Customer Relationship Management
          </div>
        </div>

        <form action={doLogin} className="card p-7 space-y-5">
          <input type="hidden" name="next" value={sp.next || "/"} />
          <div>
            <label className="label">אימייל</label>
            <input name="email" type="email" required autoComplete="email" className="input" />
          </div>
          <div>
            <label className="label">סיסמא</label>
            <input name="password" type="password" required autoComplete="current-password" className="input" />
          </div>
          {sp.error && (
            <p className="text-sm text-tulip-wine border-r-2 border-tulip-wine ps-3 py-1">{sp.error}</p>
          )}
          <button type="submit" className="btn-primary w-full">כניסה</button>
        </form>

        <p className="text-center text-xs text-tulip-muted mt-8">
          לקבלת גישה — פנו לאופיר
        </p>
      </div>
    </div>
  );
}
