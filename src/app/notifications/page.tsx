import Shell from "@/components/Shell";
import Link from "next/link";
import { all, run, audit } from "@/lib/db";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  const items = await all<any>(
    `SELECT id, kind, contact_id, title, body, url, is_read, created_at
     FROM notifications ORDER BY is_read ASC, created_at DESC LIMIT 200`
  );
  return (
    <Shell>
      <header className="flex items-end justify-between mb-6">
        <div>
          <h1 className="display text-3xl">התראות</h1>
          <p className="text-tulip-muted mt-1">תגובות נכנסות, דרפטים, שגיאות סוכן</p>
        </div>
        <form action={markAllRead}><button className="btn-ghost text-sm">סימון הכל כנקרא</button></form>
      </header>
      <div className="space-y-2">
        {items.map((n) => (
          <Link
            key={n.id}
            href={n.url || `/contacts/${n.contact_id || ""}`}
            className={`card p-4 flex items-baseline justify-between gap-3 hover:bg-tulip-cream/60 ${n.is_read ? "opacity-60" : ""}`}
          >
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className={n.kind === "reply" ? "chip-forest" : n.kind === "agent_error" ? "chip-wine" : "chip"}>
                  {n.kind === "reply" ? "תגובה" : n.kind === "agent_error" ? "שגיאה" : "אישור"}
                </span>
                <span className="font-medium">{n.title}</span>
              </div>
              {n.body && <p className="text-sm text-tulip-muted line-clamp-2">{n.body}</p>}
            </div>
            <span className="text-xs text-tulip-muted shrink-0">{n.created_at}</span>
          </Link>
        ))}
        {items.length === 0 && (
          <div className="card p-12 text-center text-tulip-muted">אין התראות.</div>
        )}
      </div>
    </Shell>
  );
}

async function markAllRead() {
  "use server";
  const session = await getSession();
  if (!session.user_id) throw new Error("UNAUTHORIZED");
  await run("UPDATE notifications SET is_read = 1 WHERE is_read = 0");
  await audit(`user:${session.email}`, "notifications", null, "mark_read_all", null, null);
}
