// Helper: pnpm tsx scripts/hash-password.ts "your password"
import bcrypt from "bcryptjs";

const pwd = process.argv[2];
if (!pwd) {
  console.error("Usage: pnpm tsx scripts/hash-password.ts \"<password>\"");
  process.exit(1);
}
console.log(bcrypt.hashSync(pwd, 12));
