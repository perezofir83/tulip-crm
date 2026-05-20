import Link from "next/link";
import { getSession } from "@/lib/auth";
import { one } from "@/lib/db";
import Logo from "./Logo";

export default async function Header() {
  const session = await getSession();
  if (!session.user_id) return null;

  const r = await one<{ c: number }>(
    "SELECT COUNT(*) AS c FROM notifications WHERE is_read = 0"
  );
  const unread = r?.c ?? 0;

  const nav = [
    { href: "/", label: "דשבורד" },
    { href: "/companies", label: "חברות" },
    { href: "/contacts", label: "אנשי קשר" },
    { href: "/outreach", label: "פניות" },
    { href: "/kb", label: "התנגדויות" },
    { href: "/chat", label: "צ׳אט" },
  ];

  return (
    <header className="bg-tulip-paper border-b border-tulip-line">
      <div className="max-w-content mx-auto px-6 h-20 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-3 group">
          <img
            src="/brand/drop.svg"
            alt=""
            className="h-7 w-auto opacity-90 group-hover:opacity-100 transition-opacity"
          />
          <Logo />
        </Link>
        <nav className="flex items-center gap-0">
          {nav.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className="px-4 py-2 text-sm text-tulip-ink hover:text-tulip-wine transition-colors"
            >
              {n.label}
            </Link>
          ))}
          <Link
            href="/notifications"
            className="px-4 py-2 text-sm text-tulip-ink hover:text-tulip-wine transition-colors"
          >
            התראות {unread > 0 && <span className="chip-wine ms-1">{unread}</span>}
          </Link>
          <form action="/api/auth/logout" method="post" className="ms-4">
            <button className="text-xs text-tulip-muted hover:text-tulip-ink transition-colors">יציאה</button>
          </form>
        </nav>
      </div>
    </header>
  );
}
