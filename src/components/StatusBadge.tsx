const LABELS: Record<string, { he: string; cls: string }> = {
  new:               { he: "חדש",                       cls: "chip-muted" },
  queued:            { he: "בתור",                      cls: "chip-muted" },
  linkedin_drafted:  { he: "דרפט LinkedIn",             cls: "chip" },
  linkedin_invited:  { he: "נשלחה פנייה ב-LinkedIn",    cls: "chip" },
  email_sent:        { he: "נשלחה פנייה במייל",         cls: "chip" },
  followup_1:        { he: "פולואופ 1 נשלח",            cls: "chip" },
  followup_2:        { he: "פולואופ 2 נשלח",            cls: "chip" },
  conversation:      { he: "נוצרה שיחה",                cls: "chip-forest" },
  meeting_set:       { he: "נקבעה פגישה",               cls: "chip-forest" },
  quote_sent:        { he: "נשלחה הצעת מחיר",           cls: "chip-forest" },
  won:               { he: "נסגרה עסקה",                cls: "chip-forest" },
  lost:              { he: "נסגר — לא רלוונטי",         cls: "chip-wine" },
  unsubscribed:      { he: "ביקש/ה להסיר",              cls: "chip-wine" },
};

export default function StatusBadge({ status }: { status: string }) {
  const cfg = LABELS[status] || { he: status, cls: "chip-muted" };
  return <span className={cfg.cls}>{cfg.he}</span>;
}

export const STATUS_OPTIONS = Object.entries(LABELS).map(([value, { he }]) => ({ value, label: he }));
