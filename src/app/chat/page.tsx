import Shell from "@/components/Shell";
import ChatForm from "./ChatForm";

export const dynamic = "force-dynamic";

export default function ChatPage() {
  return (
    <Shell>
      <header className="mb-6">
        <h1 className="display text-3xl">צ׳אט עם Claude על ה-CRM</h1>
        <p className="text-tulip-muted mt-1">
          שאלו שאלות חופשיות על הדאטה. הסוכן מקבל גישה לסיכומים — לא לפניות פרטיות של לידים.
        </p>
      </header>
      <ChatForm />
    </Shell>
  );
}
