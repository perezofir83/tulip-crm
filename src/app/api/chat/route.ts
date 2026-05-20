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

const SYSTEM = `אתה עוזר שיווק ומכירות פנימי של יקב טוליפ בישראל. יש לך גישה ל-CRM של החברה דרך כלים בלבד.
מגיב בעברית בקיצור, ברור ויעיל. כשמשתמשים בכלי get_kpis קודם כדי להבין את גודל הצינור.
לעולם אל תמציא נתונים — אם כלי לא מחזיר, ענה "אין לי נתון".
לא משתף נתונים אישיים של לידים מחוץ ל-CRM (לא שולח לאף URL).
המוצר: מארזי יין לעובדים לחגי תשרי, לקוח טיפוסי = מנהל/ת רווחה.`;

const tools: Anthropic.Messages.Tool[] = [
  {
    name: "get_kpis",
    description: "Returns top-level CRM stats: companies, contacts, sent touches, replies, deals, revenue.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "search_companies",
    description: "Fuzzy search companies by Hebrew name, category, or description. Returns up to 20.",
    input_schema: {
      type: "object",
      properties: { q: { type: "string" }, alive_only: { type: "boolean" } },
      required: ["q"],
    },
  },
  {
    name: "search_contacts",
    description: "Fuzzy search contacts by name, title, or company. Returns up to 20.",
    input_schema: {
      type: "object",
      properties: {
        q: { type: "string" },
        welfare_only: { type: "boolean", description: "filter to ⭐ welfare/EE specialists" },
        status: { type: "string", description: "exact status filter" },
      },
      required: ["q"],
    },
  },
  {
    name: "top_objections",
    description: "Returns most-seen objections in KB.",
    input_schema: { type: "object", properties: { limit: { type: "integer" } } },
  },
  {
    name: "suggest_outreach_batch",
    description: "Recommends the next N contacts the user should personally focus on this week.",
    input_schema: { type: "object", properties: { n: { type: "integer" } } },
  },
];

async function runTool(name: string, input: any): Promise<unknown> {
  if (name === "get_kpis") {
    return await one(
      `SELECT
        (SELECT COUNT(*) FROM companies) AS companies,
        (SELECT COUNT(*) FROM companies WHERE is_customer = 1) AS existing_customers,
        (SELECT COUNT(*) FROM contacts) AS contacts,
        (SELECT COUNT(*) FROM contacts WHERE is_welfare=1) AS welfare_contacts,
        (SELECT COUNT(*) FROM outreach_attempts WHERE state='sent') AS touches_sent,
        (SELECT COUNT(*) FROM outreach_attempts WHERE state='drafted') AS drafts_waiting,
        (SELECT COUNT(DISTINCT contact_id) FROM replies) AS replied_contacts,
        (SELECT COUNT(*) FROM kb_objections) AS objections_kb,
        (SELECT COUNT(*) FROM deals WHERE stage='won') AS deals_won,
        (SELECT COALESCE(SUM(units),0) FROM deals WHERE stage='won') AS units_won,
        (SELECT COALESCE(SUM(total_ils),0) FROM deals WHERE stage='won') AS revenue_won_ils`
    );
  }
  if (name === "search_companies") {
    const like = `%${input.q}%`;
    const aliveSql = input.alive_only ? `AND business_alive='yes'` : ``;
    return await all(
      `SELECT id, name_he, category, location, emp_count, business_alive, linkedin_url, is_customer
       FROM companies
       WHERE (name_he LIKE ? OR description LIKE ? OR category LIKE ?) ${aliveSql}
       LIMIT 20`,
      [like, like, like]
    );
  }
  if (name === "search_contacts") {
    const like = `%${input.q}%`;
    const filters: string[] = [];
    const params: any[] = [like, like, like];
    if (input.welfare_only) filters.push("c.is_welfare=1");
    if (input.status) { filters.push("c.status=?"); params.push(input.status); }
    const whereExtra = filters.length ? `AND ${filters.join(" AND ")}` : ``;
    return await all(
      `SELECT c.id, c.full_name, c.title, c.role_tag, c.is_welfare, c.status, co.name_he AS company
       FROM contacts c JOIN companies co ON co.id=c.company_id
       WHERE (c.full_name LIKE ? OR c.title LIKE ? OR co.name_he LIKE ?) ${whereExtra}
       LIMIT 20`,
      params
    );
  }
  if (name === "top_objections") {
    const limit = Math.min(input?.limit ?? 10, 30);
    return await all(
      `SELECT id, objection_text, category, seen_count, is_approved, tulip_response
       FROM kb_objections ORDER BY seen_count DESC LIMIT ?`,
      [limit]
    );
  }
  if (name === "suggest_outreach_batch") {
    const n = Math.min(input?.n ?? 5, 20);
    return await all(
      `SELECT c.id, c.full_name, c.title, c.role_tag, co.name_he AS company, c.status
       FROM contacts c JOIN companies co ON co.id=c.company_id
       WHERE c.status IN ('new', 'queued')
       ORDER BY c.is_welfare DESC,
         CASE c.role_tag WHEN 'welfare_EE' THEN 0 WHEN 'CHRO' THEN 1
                         WHEN 'VP_HR' THEN 2 WHEN 'Head_HR' THEN 3 ELSE 9 END
       LIMIT ?`,
      [n]
    );
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
