#!/usr/bin/env python3
"""Helper to update a placeholder company row with enriched data.
Usage: python3 enrich_update.py <cid> <json_payload>
Payload: {"name_he": "...", "category": "...", "description": "...", "location": "...",
          "emp_count": 1234, "linkedin_size_range": "201-500 employees",
          "linkedin_followers": 12345, "linkedin_url": "https://...", "clear_linkedin": false}
Only fields present are updated. Notes gets enrichment prefix.
"""
import sys
import json
import sqlite3
import datetime

DB = "/Users/perezweinberg/Projects/active/Gift box Tulip/tulip-crm/data/crm.db"

def main():
    cid = int(sys.argv[1])
    payload = json.loads(sys.argv[2])
    today = datetime.date.today().isoformat()

    con = sqlite3.connect(DB)
    cur = con.cursor()
    cur.execute("SELECT notes FROM companies WHERE id=?", (cid,))
    row = cur.fetchone()
    if not row:
        print(f"NOT FOUND cid={cid}")
        return
    existing_notes = row[0] or ""
    if "Placeholder" not in existing_notes:
        print(f"SKIP cid={cid} — not a placeholder")
        return

    fields = []
    vals = []
    for k in ("name_he", "category", "description", "location", "emp_count",
              "linkedin_size_range", "linkedin_followers", "linkedin_url"):
        if k in payload and payload[k] is not None:
            fields.append(f"{k}=?")
            vals.append(payload[k])
    if payload.get("clear_linkedin"):
        fields.append("linkedin_url=?")
        vals.append(None)

    prefix = f"✅ הועשר אוטומטית {today} · "
    new_notes = prefix + existing_notes
    fields.append("notes=?")
    vals.append(new_notes)
    fields.append("updated_at=datetime('now')")
    vals.append(cid)

    sql = f"UPDATE companies SET {', '.join(fields)} WHERE id=?"
    cur.execute(sql, vals)
    con.commit()
    print(f"OK cid={cid} updated {len(fields)-2} field(s)")

if __name__ == "__main__":
    main()
