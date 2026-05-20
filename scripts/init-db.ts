// Creates data/crm.db and applies schema. Idempotent.
import { applySchema, getDb } from "../src/lib/db";

applySchema();
const db = getDb();

// Seed default outreach templates the user can edit later.
const insert = db.prepare(`
  INSERT OR IGNORE INTO templates (slug, channel, step_number, subject, body, notes)
  VALUES (@slug, @channel, @step_number, @subject, @body, @notes)
`);

const seeds = [
  {
    slug: "linkedin_invite_v1",
    channel: "linkedin_invite",
    step_number: 1,
    subject: null,
    body:
      "היי {{first_name}},\nאני אופיר מיקב טוליפ. נשמח להתחבר — אנחנו בונים מארזי יין לחגי תשרי לחברות, וראיתי שאת/ה מובילת רווחה ב{{company}}. אשמח לשתף רעיון קצר.",
    notes: "≤ 300 chars (LinkedIn limit). Friendly, low-pressure.",
  },
  {
    slug: "linkedin_dm_followup_1",
    channel: "linkedin_dm",
    step_number: 2,
    subject: null,
    body:
      "תודה על האישור, {{first_name}} 🙏\nהנה רעיון: מארז יין כבוד מטוליפ — יין מבחר + פנקס שנה טובה. אנחנו כבר עבדנו עם {{social_proof_co}} בשנה שעברה. רוצה שאשלח קטלוג קצר?",
    notes: "Sent 1-2 days after invite accepted.",
  },
  {
    slug: "email_opener_v1",
    channel: "email",
    step_number: 1,
    subject: "מארזי שנה טובה לעובדי {{company}}",
    body:
      "שלום {{first_name}},\n\nאני אופיר מיקב טוליפ. ראש השנה מתקרב ואנחנו בונים מארזים מותאמים לחברות שמשקיעות בעובדים שלהן.\n\nשני נתונים שכדאי לדעת:\n• מארז מתחיל מ-₪{{price_from}} לעובד\n• משלוח לכל הארץ עד 3 ימי עסקים\n\nאם זה רלוונטי — אשמח לשלוח קטלוג ו-2 הצעות מותאמות.\n\nתודה,\nאופיר",
    notes: "Used when LinkedIn doesn't accept invite within 7 days.",
  },
  {
    slug: "email_followup_1",
    channel: "email",
    step_number: 2,
    subject: "Re: מארזי שנה טובה לעובדי {{company}}",
    body:
      "{{first_name}}, רק להזכיר —\n\nאם תרצי לראות איך נראה מארז טוליפ, צרפתי קטלוג בפדף.\n\nלא אפריע יותר אחרי המייל הזה. כל הצלחה.\n\nאופיר",
    notes: "Polite single-followup. No third email.",
  },
];
for (const s of seeds) insert.run(s);

console.log("✅ DB initialized at", process.env.DB_PATH || "data/crm.db");
console.log("✅ Seeded", seeds.length, "default templates");
