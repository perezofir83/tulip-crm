-- Tulip CRM — SQLite schema.
-- Append-only history pattern: outreach_attempts + replies + agent_runs are immutable logs.
-- Mutable "current state" derives from views over those logs.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

------------------------------------------------------------
-- Core entities
------------------------------------------------------------

CREATE TABLE IF NOT EXISTS companies (
  id INTEGER PRIMARY KEY,                 -- matches Google-Sheet company_id
  name_he TEXT NOT NULL,
  category TEXT,
  description TEXT,                       -- "מה הן עושות"
  location TEXT,
  emp_count INTEGER,
  emp_confidence TEXT,                    -- high/medium/low
  business_alive TEXT,                    -- yes/probably/uncertain/no
  website TEXT,
  linkedin_url TEXT,
  linkedin_followers INTEGER,
  linkedin_size_range TEXT,
  linkedin_industries TEXT,
  twitter_url TEXT,
  facebook_url TEXT,
  instagram_url TEXT,
  public_emails TEXT,                     -- comma-separated
  source_url TEXT,                        -- where we found it (Wikipedia etc.)
  notes TEXT,
  scraped_at TEXT,                        -- ISO
  -- existing-customer flags (from XLSX import)
  is_customer INTEGER NOT NULL DEFAULT 0,
  customer_email_count INTEGER NOT NULL DEFAULT 0,
  customer_units_total INTEGER NOT NULL DEFAULT 0,
  customer_notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_companies_name ON companies(name_he);
CREATE INDEX IF NOT EXISTS idx_companies_alive ON companies(business_alive);
CREATE INDEX IF NOT EXISTS idx_companies_category ON companies(category);
CREATE INDEX IF NOT EXISTS idx_companies_customer ON companies(is_customer);

-- Historical customers imported from XLSX (one row per Excel record)
CREATE TABLE IF NOT EXISTS existing_customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL,
  source TEXT NOT NULL DEFAULT 'xlsx_2026-05',
  email TEXT,
  email_domain TEXT,
  company_name_raw TEXT,
  first_name TEXT,
  last_name TEXT,
  phone TEXT,
  city TEXT,
  units_purchased INTEGER,
  budget_range TEXT,
  notes TEXT,
  status TEXT,
  status_sms TEXT,
  created_at_source TEXT,
  inserted_at TEXT NOT NULL DEFAULT (datetime('now')),
  match_method TEXT
);
CREATE INDEX IF NOT EXISTS idx_customers_company ON existing_customers(company_id);
CREATE INDEX IF NOT EXISTS idx_customers_domain ON existing_customers(email_domain);

CREATE TABLE IF NOT EXISTS contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  title TEXT,
  headline TEXT,
  location TEXT,
  linkedin_url TEXT,
  email TEXT,
  facebook_url TEXT,
  twitter_url TEXT,
  phone TEXT,
  -- priority tags assigned by enrichment / manual review
  is_welfare INTEGER NOT NULL DEFAULT 0,  -- ⭐ welfare/EE specialist
  is_decision_maker INTEGER NOT NULL DEFAULT 0,
  role_tag TEXT,                          -- CHRO / VP_HR / Head_HR / HRBP / TA / welfare_EE / CEO etc.
  -- current pipeline state — denormalized for fast filtering;
  -- always recomputable from outreach_attempts + replies (see views below)
  status TEXT NOT NULL DEFAULT 'new',
  -- new / queued / linkedin_invited / linkedin_drafted / email_sent
  -- / followup_1 / followup_2 / conversation / meeting_set
  -- / quote_sent / won / lost / unsubscribed
  next_action_at TEXT,                    -- when agent should next touch
  last_touch_at TEXT,
  last_inbound_at TEXT,
  -- agent-collected freshness signals
  last_linkedin_post_at TEXT,
  last_linkedin_post_excerpt TEXT,
  last_twitter_at TEXT,
  last_twitter_excerpt TEXT,
  notes TEXT,
  scraped_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_contacts_company ON contacts(company_id);
CREATE INDEX IF NOT EXISTS idx_contacts_status ON contacts(status);
CREATE INDEX IF NOT EXISTS idx_contacts_welfare ON contacts(is_welfare);
CREATE INDEX IF NOT EXISTS idx_contacts_next_action ON contacts(next_action_at);

------------------------------------------------------------
-- Message templates (approved by user before agent can use them)
------------------------------------------------------------

CREATE TABLE IF NOT EXISTS templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE NOT NULL,              -- e.g. linkedin_invite_v1
  channel TEXT NOT NULL,                  -- linkedin_invite / linkedin_dm / email / followup
  step_number INTEGER NOT NULL,           -- 1 = opener, 2 = followup-1, 3 = followup-2
  subject TEXT,                           -- emails only
  body TEXT NOT NULL,
  -- variables in body use {{name}}, {{company}}, {{recent_post}} placeholders
  is_active INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_templates_channel_step ON templates(channel, step_number);

------------------------------------------------------------
-- Outreach attempts (immutable log of every touch)
-- Both human-sent and agent-drafted go here.
------------------------------------------------------------

CREATE TABLE IF NOT EXISTS outreach_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,                  -- linkedin_invite/linkedin_dm/email/phone/manual
  step_number INTEGER NOT NULL,           -- 1/2/3...
  template_id INTEGER REFERENCES templates(id),
  -- the actual rendered text that went out (or sits in draft)
  subject TEXT,
  body TEXT NOT NULL,
  -- lifecycle
  state TEXT NOT NULL DEFAULT 'drafted',
  -- drafted / approved / sent / bounced / failed
  drafted_by TEXT,                        -- agent_id or 'human:ofir'
  sent_by TEXT,                           -- 'human:ofir' after user approves & sends
  draft_url TEXT,                         -- LinkedIn tab URL for review (when drafted)
  scheduled_at TEXT,
  sent_at TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_attempts_contact ON outreach_attempts(contact_id);
CREATE INDEX IF NOT EXISTS idx_attempts_state ON outreach_attempts(state);
CREATE INDEX IF NOT EXISTS idx_attempts_sent_at ON outreach_attempts(sent_at);

------------------------------------------------------------
-- Replies (inbound messages from leads)
------------------------------------------------------------

CREATE TABLE IF NOT EXISTS replies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  attempt_id INTEGER REFERENCES outreach_attempts(id),  -- which touch they replied to (if known)
  channel TEXT NOT NULL,                  -- linkedin / email / phone
  body TEXT NOT NULL,
  sentiment TEXT,                         -- positive / neutral / negative / objection / out_of_office
  intent TEXT,                            -- interested / need_more_info / not_now / not_interested / wrong_person / unsubscribe / meeting_request
  requires_attention INTEGER NOT NULL DEFAULT 1,
  attended_at TEXT,
  received_at TEXT NOT NULL,              -- when the lead sent it
  detected_at TEXT NOT NULL DEFAULT (datetime('now')),  -- when our agent saw it
  notes TEXT
);
CREATE INDEX IF NOT EXISTS idx_replies_contact ON replies(contact_id);
CREATE INDEX IF NOT EXISTS idx_replies_attention ON replies(requires_attention);

------------------------------------------------------------
-- Deals (won/lost outcomes)
------------------------------------------------------------

CREATE TABLE IF NOT EXISTS deals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  contact_id INTEGER REFERENCES contacts(id),
  stage TEXT NOT NULL DEFAULT 'qualified',
  -- qualified / proposal_sent / negotiation / won / lost
  product TEXT,                           -- e.g. "מארז סטנדרט"
  unit_price_ils INTEGER,                 -- agorot? — store as ILS integer
  units INTEGER,
  total_ils INTEGER,                      -- precomputed for fast dashboards
  expected_close_at TEXT,
  closed_at TEXT,
  loss_reason TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_deals_company ON deals(company_id);
CREATE INDEX IF NOT EXISTS idx_deals_stage ON deals(stage);

------------------------------------------------------------
-- Objections knowledge base — agent-learning loop.
-- Every inbound message produces a candidate KB entry.
-- Dedup happens at insert time via objection_key (canonical hash).
------------------------------------------------------------

CREATE TABLE IF NOT EXISTS kb_objections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  objection_key TEXT UNIQUE NOT NULL,     -- normalized fingerprint (lowercase, stopwords stripped)
  objection_text TEXT NOT NULL,           -- representative phrasing
  category TEXT,                          -- price / timing / not-decision-maker / competitor / quality / etc.
  -- Tulip's approved response (curated by user / sales coach)
  tulip_response TEXT,
  tulip_response_source TEXT,             -- 'user_provided' / 'agent_suggested' / 'employee_audio'
  -- statistics
  seen_count INTEGER NOT NULL DEFAULT 1,
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  outcome_won INTEGER NOT NULL DEFAULT 0,
  outcome_lost INTEGER NOT NULL DEFAULT 0,
  is_approved INTEGER NOT NULL DEFAULT 0, -- user must approve before agent uses tulip_response
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_kb_category ON kb_objections(category);
CREATE INDEX IF NOT EXISTS idx_kb_seen ON kb_objections(seen_count);

-- link each reply to KB entry it instantiates (for traceability)
CREATE TABLE IF NOT EXISTS kb_reply_links (
  reply_id INTEGER PRIMARY KEY REFERENCES replies(id) ON DELETE CASCADE,
  objection_id INTEGER NOT NULL REFERENCES kb_objections(id) ON DELETE CASCADE,
  similarity REAL                          -- 0..1 fuzzy match score (when matched not created)
);

------------------------------------------------------------
-- Agent runs — every automated action is logged for transparency
------------------------------------------------------------

CREATE TABLE IF NOT EXISTS agent_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id TEXT NOT NULL,                 -- 'daily-outreach-v1' / 'reply-checker-v1' / 'enrichment-v1'
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT,
  status TEXT NOT NULL DEFAULT 'running', -- running / ok / partial / failed
  input_json TEXT,                        -- parameters
  summary_json TEXT,                      -- counters: drafted=X, sent=0, replies_seen=Y
  error TEXT
);
CREATE INDEX IF NOT EXISTS idx_runs_agent ON agent_runs(agent_id, started_at);

-- Each thing the agent touched in one run
CREATE TABLE IF NOT EXISTS agent_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  contact_id INTEGER REFERENCES contacts(id),
  event_type TEXT NOT NULL,
  -- examined_profile / drafted_message / detected_reply / updated_status / skipped
  payload_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_agent_events_run ON agent_events(run_id);

------------------------------------------------------------
-- Notifications queue (in-app + email)
------------------------------------------------------------

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,                     -- reply / approval_needed / agent_error
  contact_id INTEGER REFERENCES contacts(id),
  title TEXT NOT NULL,
  body TEXT,
  url TEXT,
  is_read INTEGER NOT NULL DEFAULT 0,
  emailed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_notif_unread ON notifications(is_read);

------------------------------------------------------------
-- Audit log — every user-visible mutation goes here.
-- Combined with daily backups → bulletproof recovery.
------------------------------------------------------------

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor TEXT NOT NULL,                    -- 'user:ofir' / 'user:marketing' / 'agent:daily-v1'
  entity TEXT NOT NULL,                   -- contacts / companies / deals / kb_objections ...
  entity_id INTEGER,
  action TEXT NOT NULL,                   -- insert / update / delete / status_change
  diff_json TEXT,                         -- {before:{...}, after:{...}}
  at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_log(at);

------------------------------------------------------------
-- Users (just 2-3 expected; password gate for sharing)
------------------------------------------------------------

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  display_name TEXT,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'viewer',    -- admin / editor / viewer
  is_active INTEGER NOT NULL DEFAULT 1,
  last_login_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
