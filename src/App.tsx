import { useEffect, useState } from "react";
import SignIn from "./components/SignIn";
import Chat from "./components/Chat";
import ItemList from "./components/ItemList";
import SettingsPanel from "./components/Settings";
import {
  signIn,
  findOrCreateFolder,
  findDataFile,
  createDataFile,
  readDataFile,
  writeDataFile,
  DriveConflictError,
  type DriveSession,
  type DriveFileRef,
} from "./lib/driveClient";
import { sendMessage, type ChatMessage } from "./lib/agentClient";
import { addSingleTask, toggleSingleTaskDone } from "./lib/dataStore";
import { getActiveByok, getActiveStt, type ByokSettings } from "./lib/settingsStore";
import { emptyAppData, type AppData } from "./types/models";

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;

export default function App() {
  const [session, setSession] = useState<DriveSession | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const [fileRef, setFileRef] = useState<DriveFileRef | null>(null);
  const [data, setData] = useState<AppData | null>(null);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);

  const [byok, setByok] = useState<ByokSettings | null>(null);
  const [sttApiKey, setSttApiKey] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    setByok(getActiveByok());
    setSttApiKey(getActiveStt()?.apiKey ?? null);
  }, []);

  function refreshSettings() {
    setByok(getActiveByok());
    setSttApiKey(getActiveStt()?.apiKey ?? null);
  }

  async function handleSignIn() {
    setSigningIn(true);
    setAuthError(null);
    try {
      const newSession = await signIn(CLIENT_ID);
      setSession(newSession);

      const folderId = await findOrCreateFolder(newSession);
      const existing = await findDataFile(newSession, folderId);
      if (existing) {
        const loaded = await readDataFile(newSession, existing.fileId);
        setFileRef(existing);
        setData(loaded);
      } else {
        const initial = emptyAppData();
        const created = await createDataFile(newSession, folderId, initial);
        setFileRef(created);
        setData(initial);
      }
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : "Sign-in failed.");
    } finally {
      setSigningIn(false);
    }
  }

  async function persist(nextData: AppData) {
    if (!session || !fileRef) return;
    try {
      const newRef = await writeDataFile(session, fileRef, nextData);
      setFileRef(newRef);
      setData(nextData);
    } catch (err) {
      if (err instanceof DriveConflictError) {
        const latest = await readDataFile(session, fileRef.fileId);
        setData(latest);
        pushAssistantMessage(
          "Your data changed on another device, so I reloaded the latest version — please try that again.",
        );
        return;
      }
      pushAssistantMessage(
        `Sorry, I couldn't save that: ${err instanceof Error ? err.message : "unknown error"}.`,
      );
    }
  }

  function pushAssistantMessage(content: string) {
    setMessages((prev) => [...prev, { role: "assistant", content }]);
  }

  async function handleSend(userText: string) {
    if (!data) return;
    const nextMessages: ChatMessage[] = [...messages, { role: "user", content: userText }];
    setMessages(nextMessages);
    setSending(true);
    try {
      const response = await sendMessage(nextMessages, byok);

      if (response.toolCall?.name === "createSingleTask") {
        const nextData = addSingleTask(data, response.toolCall.input);
        await persist(nextData);
        pushAssistantMessage(`Added "${response.toolCall.input.name}" to your tasks.`);
      } else if (response.reply) {
        pushAssistantMessage(response.reply);
      } else {
        pushAssistantMessage("I didn't get a usable response — try rephrasing?");
      }
    } catch (err) {
      pushAssistantMessage(
        `Something went wrong talking to the assistant: ${err instanceof Error ? err.message : "unknown error"}.`,
      );
    } finally {
      setSending(false);
    }
  }

  function handleToggle(taskId: string) {
    if (!data) return;
    void persist(toggleSingleTaskDone(data, taskId));
  }

  if (!session || !data) {
    return <SignIn onClick={handleSignIn} loading={signingIn} error={authError} />;
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Habit Assistant</h1>
        <button
          onClick={() => setSettingsOpen((open) => !open)}
          className="rounded-md bg-slate-800 px-3 py-1.5 text-sm hover:bg-slate-700"
        >
          {byok ? `Using your ${byok.provider} key` : "Using free trial"} ⚙
        </button>
      </div>

      {settingsOpen && (
        <SettingsPanel
          activeProvider={byok?.provider ?? null}
          onChange={refreshSettings}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      <div className="grid flex-1 grid-cols-1 gap-4 md:grid-cols-2">
        <div className="min-h-[60vh] md:min-h-0">
          <Chat messages={messages} onSend={handleSend} sending={sending} sttApiKey={sttApiKey} />
        </div>
        <div>
          <h2 className="mb-2 text-sm font-medium uppercase tracking-wide text-slate-400">
            Tasks
          </h2>
          <ItemList tasks={data.singleTasks} onToggle={handleToggle} />
        </div>
      </div>
    </div>
  );
}
