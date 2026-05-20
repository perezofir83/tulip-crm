# Tulip CRM — מערכת ניהול לידים יקב טוליפ

מערכת CRM מקומית (local-first) הבנויה על SQLite + Next.js. כל הנתונים יושבים
בקובץ אחד (`data/crm.db`) → קל לגבות, קל לעקוב אחר שינויים.

## תכונות עיקריות

- **חברות** — רשימה עם קטגוריה, תיאור, מיקום, מספר עובדים, סושיאל (LinkedIn / X / Facebook)
- **אנשי קשר** — דף לכל ליד עם LinkedIn / מייל / פייסבוק + טיימליין פניות
- **תור פניות לאישור** — הסוכן מכין דרפטים, את/ה מאשר/ת ושולח/ת
- **סטטוס מתעדכן** — חדש → נשלחה פנייה → פולואופ 1 → שיחה → פגישה → הצעת מחיר → נסגרה
- **מאגר התנגדויות (KB)** — כל תגובת ליד נשמרת ולומדת; ניתן לאשר תשובת טוליפ לכל אחת
- **דשבורד** — KPIs של פניות נשלחו, אחוז מענה, עסקאות סגורות, הכנסות
- **חיפוש בכל מקום** — בחברות, באנשי קשר, בהתנגדויות
- **צ׳אט Claude** — שואלים שאלות חופשיות על ה-CRM; Claude ניגש לכלים read-only
- **Audit log + backup יומי** — כל שינוי נשמר; גיבוי כפול (SQLite binary + JSON) ב-`data/backups/`

## התקנה ראשונית

```bash
cd tulip-crm
pnpm install

# 1. צור .env.local משלך
cp .env.example .env.local
# ערוך .env.local — אם SESSION_SECRET עדיין placeholder, צור אחד:
openssl rand -base64 32   # העתק לתוך SESSION_SECRET

# 2. אתחל DB
pnpm db:init

# 3. צור משתמש אדמין ראשון
pnpm tsx scripts/create-user.ts "perezofir@gmail.com" "your-strong-password" admin

# 4. ייבא נתונים מהגיליון (דרוש gws auth)
pnpm db:import

# 5. הרץ
pnpm dev
# פתח http://localhost:3000 → הזן את האימייל והסיסמא
```

## תוספת משתמש למנהלת שיווק

```bash
pnpm tsx scripts/create-user.ts "marketing@tulip-winery.co.il" "her-password" editor
```

תפקידים:
- `admin` — הכל
- `editor` — שינויים בסטטוסים, שליחת פניות, עריכת KB
- `viewer` — קריאה בלבד (TODO: עדיין לא נאכף בכל מקום)

## גיבוי

הסקריפט `pnpm db:backup` מבצע **3 שכבות**:

1. **שכבה 1** — עותק בינארי של `crm.db` ל-`data/backups/YYYY-MM-DD.db`
2. **שכבה 2** — דאמפ JSON של כל הטבלאות ל-`data/backups/YYYY-MM-DD/<table>.json`
3. **שכבה 3 (אופציונלי)** — `git push` ל-repo נפרד אם הוגדר `BACKUP_GIT_REMOTE`

מומלץ להוסיף ל-cron / launchd:
```
0 3 * * * cd /path/to/tulip-crm && pnpm db:backup
```

## סוכנים אוטומטיים

המערכת תוכננה מההתחלה לעבודה של סוכן.

### `pnpm agent:daily` — מכין 20-30 דרפטים יומיים

- בוחר את הלידים החמים ביותר (⭐ רווחה > CHRO > VP HR > Head HR > HRBP > TA)
- מדלג על אנשי קשר שכבר פנינו אליהם ב-72 השעות האחרונות
- ממלא טמפלט לפי הערוץ הנכון (LinkedIn invite ראשון, ואז DM, ואז מייל)
- שומר כדרפט ב-`outreach_attempts` עם `state='drafted'`
- מייצר התראות לאישור

### `pnpm tsx scripts/agent-linkedin-draft.ts` — פותח טאבים ב-LinkedIn

הסקריפט (כרגע stub) יפתח 20 טאבים ב-LinkedIn עם דרפטים מוכנים. את/ה עובר/ת
אחד-אחד, קורא/ת, מאשר/ת ושולח/ת. הסקריפט **לא שולח אוטומטית** — זה במכוון.

להפעלה מלאה, להתקין Playwright:
```bash
pnpm add -D playwright
npx playwright install chromium
```

### `pnpm tsx scripts/agent-reply-check.ts` — בודק תגובות כל 5 שעות

מ-LinkedIn DMs + Gmail. כל תגובה חדשה:
- נשמרת ב-`replies`
- מתווספת ל-KB (עם dedup)
- יוצרת התראה דורשת-התייחסות

## מבנה הנתונים (תקציר)

| טבלה | תפקיד |
|---|---|
| `companies` | מקור-האמת על חברות. מתעדכן מ-Google Sheet ב-`db:import`. |
| `contacts` | אנשי קשר. אגרגציה של HR Contacts + Track A + ייבוא ידני. |
| `templates` | טמפלטי הודעות מאושרים. הסוכן מנפיק רק מתוך כאן. |
| `outreach_attempts` | **לוג בלתי-משתנה** של כל פנייה (דרפט / נשלח / נכשל). |
| `replies` | תגובות נכנסות מהלידים. |
| `kb_objections` | מאגר התנגדויות שלומד עם הזמן. |
| `deals` | עסקאות סגורות + הצעות מחיר. |
| `agent_runs` + `agent_events` | תיעוד של כל ריצת סוכן (שקיפות מלאה). |
| `notifications` | תור התראות in-app + אימייל. |
| `audit_log` | כל שינוי שמשתמש או סוכן ביצעו. |
| `users` | משתמשי המערכת + סיסמאות (bcrypt). |

## ארכיטקטורה

- **Next.js 14 (App Router)** — server components + server actions
- **SQLite** דרך `better-sqlite3` (סינכרוני, מהיר, ללא רשת)
- **Tailwind** עם פלטה של טוליפ (יין-קרם-יער)
- **iron-session** + bcrypt לאוטנטיקציה
- **Anthropic SDK** לצ׳אט (אופציונלי — נדרש `ANTHROPIC_API_KEY`)

## פריסה (כשמוכנים)

ההמלצה היא **Vercel + Supabase** או **VPS שלך**:

- Vercel: ה-app מעלים, אבל ה-DB ב-Supabase Postgres (לא SQLite ב-prod —
  Vercel filesystem הוא ephemeral)
- VPS פשוט: pm2 + SQLite ב-volume קבוע, גיבוי לאחסון נפרד

לפרטים, ראה `docs/DEPLOY.md` (TODO).
