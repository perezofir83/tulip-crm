/**
 * Create or update a CRM user. Used to bootstrap the first admin and to add
 * the marketing manager later.
 *
 * Usage: pnpm tsx scripts/create-user.ts <email> <password> [role]
 *        role = admin | editor | viewer  (default: admin)
 */
import bcrypt from "bcryptjs";
import { applySchema, getDb } from "../src/lib/db";

const [, , email, password, role = "admin"] = process.argv;
if (!email || !password) {
  console.error('Usage: pnpm tsx scripts/create-user.ts "<email>" "<password>" [admin|editor|viewer]');
  process.exit(1);
}

applySchema();
const db = getDb();
const hash = bcrypt.hashSync(password, 12);

const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email.toLowerCase()) as { id: number } | undefined;
if (existing) {
  db.prepare("UPDATE users SET password_hash = ?, role = ?, is_active = 1 WHERE id = ?")
    .run(hash, role, existing.id);
  console.log(`✅ updated user ${email} (role=${role})`);
} else {
  db.prepare(
    "INSERT INTO users (email, password_hash, role, display_name) VALUES (?, ?, ?, ?)"
  ).run(email.toLowerCase(), hash, role, email.split("@")[0]);
  console.log(`✅ created user ${email} (role=${role})`);
}
