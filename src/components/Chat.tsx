import { useState } from "react";
import type { AgentHistoryMessage } from "../lib/agentClient";
import type { ByokProvider } from "../lib/settingsStore";
import { toDisplayMessages, type ChatDownload } from "../server/agentHistory";
import VoiceButton from "./VoiceButton";

interface ChatProps {
  messages: AgentHistoryMessage[];
  onSend: (message: string) => void;
  sending: boolean;
  sttApiKey: string | null;
  byokProvider: ByokProvider | null;
}

export default function Chat({ messages, onSend, sending, sttApiKey, byokProvider }: ChatProps) {
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
      <p className="text-right text-xs text-slate-500">
        {byokProvider ? `Using your ${byokProvider} key` : "Using free trial"}
      </p>
      <div className="flex-1 space-y-2 overflow-y-auto rounded-md bg-slate-900 p-3">
        {messages.length === 0 && (
          <p className="text-sm text-slate-500">
            Try: "add a task to buy milk", or "set me up a morning routine" to get a few habits made for you.{" "}
            <a href="/help.html" target="_blank" rel="noreferrer" className="text-violet-400 underline">
              More things you can say
            </a>
          </p>
        )}
        {toDisplayMessages(messages).map((message, index) => (
          <div
            key={index}
            className={
              message.role === "user"
                ? "ml-auto max-w-[80%] rounded-md bg-violet-600 px-3 py-2 text-white"
                : "mr-auto max-w-[80%] whitespace-pre-wrap rounded-md bg-slate-700 px-3 py-2 text-slate-100"
            }
          >
            {message.content}
            {message.download && (
              <button
                onClick={() => saveDownload(message.download!)}
                className="mt-2 block rounded-md bg-violet-500 px-3 py-1 text-sm font-medium text-white hover:bg-violet-400"
              >
                Download {message.download.filename}
              </button>
            )}
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

// §72: an export saved from its Download button. The byte-order mark makes Excel read the
// file as UTF-8, so accents and emoji in names and notes come through.
function saveDownload(download: ChatDownload) {
  const url = URL.createObjectURL(new Blob(["\uFEFF", download.text], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = download.filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
