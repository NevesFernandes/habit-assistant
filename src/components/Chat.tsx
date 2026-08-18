import { useState } from "react";
import type { ChatMessage } from "../lib/agentClient";
import VoiceButton from "./VoiceButton";

interface ChatProps {
  messages: ChatMessage[];
  onSend: (message: string) => void;
  sending: boolean;
  sttApiKey: string | null;
}

export default function Chat({ messages, onSend, sending, sttApiKey }: ChatProps) {
  const [draft, setDraft] = useState("");

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = draft.trim();
    if (!trimmed || sending) return;
    onSend(trimmed);
    setDraft("");
  }

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex-1 space-y-2 overflow-y-auto rounded-md bg-slate-900 p-3">
        {messages.length === 0 && (
          <p className="text-sm text-slate-500">
            Try: "add a task to buy milk" — or something vague, to see it ask a follow-up.
          </p>
        )}
        {messages.map((message, index) => (
          <div
            key={index}
            className={
              message.role === "user"
                ? "ml-auto max-w-[80%] rounded-md bg-violet-600 px-3 py-2 text-white"
                : "mr-auto max-w-[80%] rounded-md bg-slate-700 px-3 py-2 text-slate-100"
            }
          >
            {message.content}
          </div>
        ))}
        {sending && <div className="mr-auto text-sm text-slate-500">Thinking…</div>}
      </div>
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Tell the assistant what you want…"
          className="flex-1 rounded-md bg-slate-800 px-3 py-2 outline-none focus:ring-2 focus:ring-violet-500"
          disabled={sending}
        />
        <button
          type="submit"
          disabled={sending || !draft.trim()}
          className="rounded-md bg-violet-500 px-4 py-2 font-medium text-white transition hover:bg-violet-400 disabled:opacity-50"
        >
          Send
        </button>
      </form>
      <VoiceButton sttApiKey={sttApiKey} disabled={sending} onTranscribed={onSend} />
    </div>
  );
}
