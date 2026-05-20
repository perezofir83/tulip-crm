#!/usr/bin/env python3
"""
Cross-reference an Excel export of historical Tulip customers against the
companies table in our CRM, then mark matched companies as `is_customer=1`.

Match strategy (in priority order):
  1. Company-name column → fuzzy-match against companies.name_he
  2. Email domain → companies.website domain
     (skip generic free-mail: gmail, walla, etc.)

Every Excel row is preserved verbatim in `existing_customers` table for audit.

Usage:
  python3 scripts/import-existing-customers.py "/path/to/file.xlsx"
  python3 scripts/import-existing-customers.py --reset  # clear customer marks before reimport
"""
import sqlite3, openpyxl, re, sys
from collections import defaultdict

DB = "data/crm.db"

# Columns in the Excel file (0-indexed) — keep in sync if format changes
COL_STATUS = 0
COL_STATUS_SMS = 1
COL_CREATED = 2
COL_FIRST_NAME = 3
COL_LAST_NAME = 4
COL_EMAIL = 5
COL_PHONE = 6
COL_CELL = 7
COL_CITY = 10
COL_COMPANY = 14
COL_UNITS = 18
COL_BUDGET = 19
COL_NOTES = 20

FREE_DOMAINS = {
    "gmail.com", "yahoo.com", "hotmail.com", "walla.co.il", "walla.com",
    "outlook.com", "icloud.com", "me.com", "aol.com", "live.com", "mac.com",
    "gmx.com", "protonmail.com", "yandex.com", "msn.com", "webmail.com",
}

def norm_name(s):
    if not s: return ""
    s = str(s).strip().lower()
    s = re.sub(r'[\(\)\"\'.,]', '', s)
    s = re.sub(r'\s+', ' ', s)
    s = re.sub(r'\s+(ltd|בע"מ|בעמ|inc|llc|group|israel|ישראל|holdings|gmbh)\.?$', '', s)
    return s.strip()

def domain_from_url(url):
    if not url: return ""
    m = re.search(r'https?://(?:www\.)?([^/]+)', url)
    return m.group(1).lower() if m else url.lower().replace("www.", "")

def domain_from_email(email):
    if not email or "@" not in email: return ""
    return email.split("@")[-1].lower().strip()

def root_domain(d):
    d = d.lstrip().replace("www.", "")
    parts = d.split('.')
    return '.'.join(parts[-2:]) if len(parts) >= 2 else d

def main():
    args = sys.argv[1:]
    reset = "--reset" in args
    xlsx_path = next((a for a in args if not a.startswith("--")), None)
    if not xlsx_path:
        print("Usage: python3 scripts/import-existing-customers.py <file.xlsx> [--reset]")
        sys.exit(1)

    con = sqlite3.connect(DB)
    cur = con.cursor()

    if reset:
        cur.execute("DELETE FROM existing_customers")
        cur.execute("UPDATE companies SET is_customer=0, customer_email_count=0, customer_units_total=0, customer_notes=NULL")
        print("⚠️  reset previous customer marks")

    # Read Excel
    wb = openpyxl.load_workbook(xlsx_path, data_only=True)
    ws = wb[wb.sheetnames[0]]
    rows = list(ws.iter_rows(min_row=2, values_only=True))
    print(f"Read {len(rows)} rows from {xlsx_path}")

    # Build company lookups
    companies = cur.execute("SELECT id, name_he, website FROM companies").fetchall()
    name_to_id, domain_to_id = {}, {}
    for cid, name_he, website in companies:
        nn = norm_name(name_he)
        if nn: name_to_id.setdefault(nn, cid)
        if website:
            d = root_domain(domain_from_url(website))
            if d: domain_to_id.setdefault(d, cid)

    matches = defaultdict(lambda: {"emails": set(), "units": 0, "notes": []})

    for r in rows:
        if len(r) < 21:
            r = list(r) + [None] * (21 - len(r))
        company_raw = r[COL_COMPANY]
        email = (r[COL_EMAIL] or "").strip().lower() or None
        edomain = root_domain(domain_from_email(email)) if email else ""

        matched_id, method = None, "unmatched"
        if company_raw:
            nn = norm_name(company_raw)
            if nn in name_to_id:
                matched_id, method = name_to_id[nn], "company_name_exact"
            else:
                for db_name, cid in name_to_id.items():
                    if db_name and nn and len(nn) >= 3 and len(db_name) >= 3 \
                       and (db_name in nn or nn in db_name):
                        matched_id, method = cid, "company_name_partial"
                        break
        if not matched_id and edomain and edomain not in FREE_DOMAINS:
            if edomain in domain_to_id:
                matched_id, method = domain_to_id[edomain], "domain_exact"
            else:
                for db_d, cid in domain_to_id.items():
                    if db_d and (db_d.endswith(edomain) or edomain.endswith(db_d)):
                        matched_id, method = cid, "domain_partial"
                        break

        units_int = None
        if r[COL_UNITS] is not None:
            try:
                s = str(r[COL_UNITS]).strip()
                if s.isdigit(): units_int = int(s)
            except: pass

        cur.execute("""
          INSERT INTO existing_customers
            (company_id, email, email_domain, company_name_raw, first_name, last_name,
             phone, city, units_purchased, budget_range, notes, status, status_sms,
             created_at_source, match_method)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (matched_id, email, edomain or None, company_raw,
              r[COL_FIRST_NAME], r[COL_LAST_NAME],
              r[COL_PHONE] or r[COL_CELL], r[COL_CITY],
              units_int, r[COL_BUDGET], r[COL_NOTES],
              r[COL_STATUS], r[COL_STATUS_SMS], r[COL_CREATED], method))

        if matched_id:
            m = matches[matched_id]
            if email: m["emails"].add(email)
            if units_int: m["units"] += units_int
            if r[COL_NOTES]: m["notes"].append(str(r[COL_NOTES]).strip())

    for cid, info in matches.items():
        cur.execute("""
          UPDATE companies SET
            is_customer = 1,
            customer_email_count = ?,
            customer_units_total = ?,
            customer_notes = ?,
            updated_at = datetime('now')
          WHERE id = ?
        """, (len(info["emails"]), info["units"],
              " | ".join(info["notes"])[:1000] if info["notes"] else None, cid))

    con.commit()
    print(f"✅ {len(rows)} rows logged, matched to {len(matches)} unique companies")

    methods = cur.execute("""
      SELECT match_method, COUNT(*) FROM existing_customers
      GROUP BY match_method ORDER BY 2 DESC
    """).fetchall()
    for m, c in methods: print(f"  {m:25} {c}")
    con.close()

if __name__ == "__main__":
    main()
