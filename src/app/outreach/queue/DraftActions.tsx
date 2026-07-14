"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

type Action = (fd: FormData) => Promise<void>;

export default function DraftActions({
  attemptId,
  linkedinUrl,
  draftUrl,
  firstName,
  markSent,
  discardDraft,
}: {
  attemptId: number;
  linkedinUrl?: string | null;
  draftUrl?: string | null;
  firstName: string;
  markSent: Action;
  discardDraft: Action;
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function run(action: Action) {
    startTransition(async () => {
      const fd = new FormData();
      fd.set("attempt_id", String(attemptId));
      await action(fd);
      // Force an immediate in-place refetch so the row updates without a manual page refresh.
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        disabled={pending}
        onClick={() => run(markSent)}
        className="btn-primary text-sm disabled:opacity-50"
      >
        {pending ? "מסמן…" : "סימון כנשלח"}
      </button>
      {linkedinUrl && (
        <a href={linkedinUrl} target="_blank" rel="noreferrer" className="btn-ghost text-sm">
          פתח LinkedIn של {firstName}
        </a>
      )}
      {draftUrl && (
        <a href={draftUrl} target="_blank" rel="noreferrer" className="btn-ghost text-sm">
          פתח דרפט שהוכן
        </a>
      )}
      <button
        type="button"
        disabled={pending}
        onClick={() => run(discardDraft)}
        className="btn-link text-sm text-tulip-muted hover:text-tulip-wine ms-auto disabled:opacity-50"
      >
        ביטול דרפט
      </button>
    </>
  );
}
