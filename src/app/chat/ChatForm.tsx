"use client";
import { useState, useRef, useEffect } from "react";

type Msg = { role: "user" | "assistant"; content: string };

export default function ChatForm() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    const next: Msg[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setBusy(true);
    try {
      const r = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: next }),
      });
      const data = await r.json();
      if (data.error) throw new Error(data.error);
      setMessages([...next, { role: "assistant", content: data.text }]);
    } catch (err) {
      setMessages([...next, { role: "assistant", content: `שגיאה: ${(err as Error).message}` }]);
    } finally {
      setBusy(false);
    }
  }

  const samples = [
    "כמה לידים ⭐ רווחה יש לי?",
    "אילו חברות בקטגוריית בנקאות לא קיבלו פנייה?",
    "מה ההתנגדות הכי נפוצה בחודש האחרון?",
    "תן/י לי 5 לידים שכדאי לפנות אליהם השבוע",
  ];

  return (
    <div className="card p-6 min-h-[60vh] flex flex-col">
      <div className="flex-1 space-y-4 overflow-y-auto">
        {messages.length === 0 && (
          <div className="text-tulip-muted">
            <p className="mb-4">דוגמאות לשאלות:</p>
            <ul className="space-y-2">
              {samples.map((s) => (
                <li key={s}>
                  <button
                    type="button"
                    onClick={() => setInput(s)}
                    className="btn-link text-sm text-start"
                  >
                    → {s}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
            <div className={
              m.role === "user"
                ? "max-w-[80%] bg-tulip-wine text-tulip-cream px-4 py-2 rounded-sm"
                : "max-w-[80%] bg-tulip-cream border border-tulip-sand text-tulip-ink px-4 py-2 rounded-sm whitespace-pre-wrap"
            }>
              {m.content}
            </div>
          </div>
        ))}
        {busy && (
          <div className="flex justify-start">
            <div className="bg-tulip-cream border border-tulip-sand text-tulip-muted px-4 py-2 rounded-sm text-sm">
              Claude חושב…
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={send} className="border-t border-tulip-sand pt-4 mt-4 flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="שאלי או שאל משהו על ה-CRM…"
          className="input"
          disabled={busy}
        />
        <button className="btn-primary text-sm" disabled={busy || !input.trim()}>שליחה</button>
      </form>
    </div>
  );
}
