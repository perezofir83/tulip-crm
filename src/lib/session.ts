import type { SessionOptions } from "iron-session";

export type SessionData = {
  user_id?: number;
  email?: string;
  role?: "admin" | "editor" | "viewer";
};

export const sessionOptions: SessionOptions = {
  password:
    process.env.SESSION_SECRET ||
    "dev-only-secret-replace-in-prod-min-32-chars-XXXXXXXXX",
  cookieName: "tulip_crm_session",
  cookieOptions: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 14, // 2 weeks
  },
};
