import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { one, all } from "@/lib/db";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Claude chat proxy with whitelisted CRM tools.
 * The user can ask natural-language questions; Claude calls tools that
 * run safe read-only SQL against the local DB.
 */

const SYSTEM = `אתה עוזר שיווק ומכירות פנימי של יקב טוליפ בישראל. יש לך גישה מלאה ל-CRM דרך כלי \`run_query\` שמריץ SQL read-only כל שאילתה.

חוקים:
- **תמיד נסה לענות מהדאטה** לפני שאתה אומר "אין לי נתון". אם המשתמש שאל משהו ספציפי, רוץ שאילתה.
- לפני שאתה כותב SQL מורכב, חזור על מבנה הסכמה בקצרה אם יש ספק.
- מגיב בעברית בקיצור, ברור ויעיל.
- לא משתף נתונים אישיים של לידים מחוץ ל-CRM (אל תשלח לאף URL).
- המוצר: מארזי יין לעובדים לחגי תשרי, לקוח טיפוסי = מנהל/ת רווחה.

הסכמה (הטבלאות העיקריות):
- **companies**: id, name_he, category, description, location, emp_count, business_alive,
  website, linkedin_url, linkedin_followers, twitter_url, facebook_url, public_emails,
  is_customer (0/1), customer_email_count, customer_units_total
- **contacts**: id, company_id, full_name, title, headline, location, linkedin_url, email,
  phone, twitter_url, facebook_url, is_welfare (0/1), role_tag (welfare_EE/CHRO/VP_HR/Head_HR/HRBP/TA),
  status (new/queued/linkedin_invited/email_sent/conversation/meeting_set/quote_sent/won/lost)
- **existing_customers**: היסטוריית רכישות מקובץ XLSX. כל שורה = רכישה. company_id, email, units_purchased
- **outreach_attempts**: contact_id, channel (linkedin_invite/linkedin_dm/email), step_number, state (drafted/sent/failed)
- **replies**: contact_id, channel, body, sentiment, intent, received_at
- **kb_objections**: objection_text, tulip_response, seen_count
- **deals**: company_id, contact_id, stage (qualified/proposal_sent/won/lost), units, total_ils
- **notifications**, **agent_runs**, **audit_log**, **templates**, **users**

לדוגמה — "כמה לידים עם LinkedIn":
SELECT COUNT(*) FROM contacts WHERE linkedin_url IS NOT NULL AND linkedin_url != ''`;

const tools: Anthropic.Messages.Tool[] = [
  {
    name: "run_query",
    description:
      "Run a READ-ONLY SQL query against the CRM (SQLite syntax). Use freely to answer any question. " +
      "Only SELECT / WITH / EXPLAIN allowed — any write (INSERT/UPDATE/DELETE/DROP/etc.) will be rejected. " +
      "Returns up to 200 rows.",
    input_schema: {
      type: "object",
      properties: {
        sql: { type: "string", description: "The SQL SELECT/WITH statement." },
        explanation: { type: "string", description: "One-sentence summary of what you're checking." },
      },
      required: ["sql"],
    },
  },
  {
    name: "get_kpis",
    description: "Returns top-level CRM stats. Use as a quick first probe before deeper queries.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "list_tables",
    description: "Lists all tables and their column schemas. Use when you need to confirm field names.",
    input_schema: { type: "object", properties: {} },
  },
];

// Whitelist of allowed query verbs — anything else is rejected before hitting the DB
const SAFE_QUERY = /^\s*(SELECT|WITH|EXPLAIN)\b/i;
const FORBIDDEN = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|ATTACH|DETACH|PRAGMA|VACUUM|REPLACE)\b/i;

async function runTool(name: string, input: any): Promise<unknown> {
  if (name === "run_query") {
    const sql = String(input?.sql ?? "").trim();
    if (!SAFE_QUERY.test(sql)) {
      return { error: "Only SELECT / WITH / EXPLAIN queries allowed." };
    }
    if (FORBIDDEN.test(sql)) {
      return { error: "Query contains a write/DDL keyword; rejected." };
    }
    // Append LIMIT 200 if missing
    const sqlWithLimit = /\blimit\b/i.test(sql) ? sql : `${sql.replace(/;?\s*$/, "")} LIMIT 200`;
    try {
      const rows = await all(sqlWithLimit);
      return { row_count: rows.length, rows };
    } catch (e: any) {
      return { error: e.message };
    }
  }

  if (name === "get_kpis") {
    return await one(
      `SELECT
        (SELECT COUNT(*) FROM companies) AS companies,
        (SELECT COUNT(*) FROM companies WHERE is_customer = 1) AS existing_customers,
        (SELECT COUNT(*) FROM companies WHERE linkedin_url IS NOT NULL AND linkedin_url != '') AS companies_with_linkedin,
        (SELECT COUNT(*) FROM contacts) AS contacts,
        (SELECT COUNT(*) FROM contacts WHERE linkedin_url IS NOT NULL AND linkedin_url != '') AS contacts_with_linkedin,
        (SELECT COUNT(*) FROM contacts WHERE email IS NOT NULL AND email != '') AS contacts_with_email,
        (SELECT COUNT(*) FROM contacts WHERE is_welfare=1) AS welfare_contacts,
        (SELECT COUNT(*) FROM outreach_attempts WHERE state='sent') AS touches_sent,
        (SELECT COUNT(*) FROM outreach_attempts WHERE state='drafted') AS drafts_waiting,
        (SELECT COUNT(DISTINCT contact_id) FROM replies) AS replied_contacts,
        (SELECT COUNT(*) FROM kb_objections) AS objections_kb,
        (SELECT COUNT(*) FROM deals WHERE stage='won') AS deals_won,
        (SELECT COALESCE(SUM(units),0) FROM deals WHERE stage='won') AS units_won,
        (SELECT COALESCE(SUM(total_ils),0) FROM deals WHERE stage='won') AS revenue_won_ils,
        (SELECT COUNT(*) FROM existing_customers) AS historical_purchases`
    );
  }

  if (name === "list_tables") {
    const tables = await all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    );
    const schemas: Record<string, any[]> = {};
    for (const t of tables) {
      const cols = await all(`PRAGMA table_info("${t.name}")`);
      schemas[t.name] = cols.map((c: any) => ({ name: c.name, type: c.type, notnull: c.notnull }));
    }
    return schemas;
  }

  return { error: `unknown tool: ${name}` };
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session.user_id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({
      error: "צ׳אט מושבת — חסר ANTHROPIC_API_KEY ב-.env.local",
    });
  }

  const { messages } = await req.json();
  const client = new Anthropic({ apiKey });

  let convo: Anthropic.Messages.MessageParam[] = messages.map((m: any) => ({
    role: m.role,
    content: m.content,
  }));

  // Tool-use loop: up to 5 rounds of tool calls before final text.
  for (let i = 0; i < 5; i++) {
    const res = await client.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 1500,
      system: SYSTEM,
      tools,
      messages: convo,
    });
    if (res.stop_reason === "tool_use") {
      const toolUses = res.content.filter(
        (b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use"
      );
      convo.push({ role: "assistant", content: res.content });
      const results = await Promise.all(
        toolUses.map(async (tu) => ({
          type: "tool_result" as const,
          tool_use_id: tu.id,
          content: JSON.stringify(await runTool(tu.name, tu.input)),
        }))
      );
      convo.push({ role: "user", content: results });
      continue;
    }
    const text = res.content
      .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    return NextResponse.json({ text });
  }
  return NextResponse.json({ error: "Tool loop exceeded" }, { status: 500 });
}
