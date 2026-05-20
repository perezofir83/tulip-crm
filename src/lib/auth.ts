import { cookies } from "next/headers";
import { getIronSession } from "iron-session";
import bcrypt from "bcryptjs";
import { sessionOptions, type SessionData } from "./session";
import { one, run } from "./db";

export async function getSession() {
  return getIronSession<SessionData>(await cookies(), sessionOptions);
}

export async function requireUser() {
  const session = await getSession();
  if (!session.user_id) {
    throw new Error("UNAUTHORIZED");
  }
  return session;
}

type UserRow = {
  id: number;
  email: string;
  password_hash: string;
  role: "admin" | "editor" | "viewer";
  is_active: number;
};

export async function login(
  email: string,
  password: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await one<UserRow>(
    "SELECT id, email, password_hash, role, is_active FROM users WHERE email = ?",
    [email.toLowerCase().trim()]
  );
  if (!user) return { ok: false, error: "האימייל או הסיסמא שגויים" };
  if (!user.is_active) return { ok: false, error: "המשתמש מושבת" };
  if (!bcrypt.compareSync(password, user.password_hash))
    return { ok: false, error: "האימייל או הסיסמא שגויים" };

  await run("UPDATE users SET last_login_at = datetime('now') WHERE id = ?", [user.id]);

  const session = await getSession();
  session.user_id = user.id;
  session.email = user.email;
  session.role = user.role;
  await session.save();
  return { ok: true };
}

export async function logout() {
  const session = await getSession();
  session.destroy();
}
