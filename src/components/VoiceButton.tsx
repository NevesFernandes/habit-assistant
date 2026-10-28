import { useEffect, useRef, useState } from "react";
import { transcribeAudio } from "../lib/transcribeClient";
import { hasSpeech } from "../lib/voiceActivityDetection";

interface VoiceButtonProps {
  sttApiKey: string | null;
  disabled: boolean;
  onTranscribed: (text: string) => void;
}

const CANDIDATE_MIME_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
const MIN_RECORDING_MS = 400; // below this, it's almost certainly an accidental tap, not speech
const TOO_SHORT_MESSAGE = "Audio too short — please keep the button pressed while you speak.";
const NO_SPEECH_MESSAGE = "No speech detected — please try again.";
// §45: sliding the finger this far up from where the press began locks the recording, so the
// user can let go and keep talking, then tap Send (or Cancel).
const LOCK_SLIDE_PX = 70;

function pickSupportedMimeType(): string | undefined {
  return CANDIDATE_MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
}

export default function VoiceButton({ sttApiKey, disabled, onTranscribed }: VoiceButtonProps) {
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [locked, setLocked] = useState(false);
  const [lockProgress, setLockProgress] = useState(0); // 0..1, how far toward the lock the finger has slid
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const startTimeRef = useRef(0);
  const pressStartYRef = useRef(0);
  const lockedRef = useRef(false); // read in pointer handlers, which can run before a re-render
  const discardRef = useRef(false); // Cancel: stop without transcribing

  useEffect(() => {
    if (!locked) return;
    const timer = setInterval(() => setElapsedSeconds(Math.floor((Date.now() - startTimeRef.current) / 1000)), 500);
    return () => clearInterval(timer);
  }, [locked]);

  async function startRecording() {
    if (recorderRef.current) return; // already recording — avoid double-start from duplicate pointer/touch events
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const mimeType = pickSupportedMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => void handleStopped(recorder.mimeType || mimeType || "audio/webm");

      recorder.start();
      recorderRef.current = recorder;
      startTimeRef.current = Date.now();
      setRecording(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't access the microphone.");
    }
  }

  function stopRecording(discard = false) {
    lockedRef.current = false;
    setLocked(false);
    setLockProgress(0);
    setElapsedSeconds(0);
    if (!recorderRef.current) return;
    discardRef.current = discard;
    recorderRef.current.stop();
    recorderRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    setRecording(false);
  }

  function handlePointerMove(event: React.PointerEvent) {
    if (lockedRef.current || !recorderRef.current) return;
    const slid = pressStartYRef.current - event.clientY;
    if (slid >= LOCK_SLIDE_PX) {
      lockedRef.current = true;
      setLocked(true);
      setLockProgress(0);
      return;
    }
    setLockProgress(Math.max(0, slid) / LOCK_SLIDE_PX);
  }

  function handleRelease() {
    if (lockedRef.current) return; // locked: keep recording until Send or Cancel
    stopRecording();
  }

  async function handleStopped(mimeType: string) {
    const blob = new Blob(chunksRef.current, { type: mimeType });
    chunksRef.current = [];
    if (discardRef.current) {
      discardRef.current = false;
      return;
    }

    const durationMs = Date.now() - startTimeRef.current;
    if (durationMs < MIN_RECORDING_MS || blob.size === 0) {
      setError(TOO_SHORT_MESSAGE);
      return;
    }

    setTranscribing(true);
    try {
      if (!(await hasSpeech(blob))) {
        setError(NO_SPEECH_MESSAGE);
        return;
      }
      const text = await transcribeAudio(blob, sttApiKey);
      if (text.trim()) onTranscribed(text.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Transcription failed.");
    } finally {
      setTranscribing(false);
    }
  }

  if (locked) {
    return (
      <div className="flex items-center justify-center gap-3">
        <button
          type="button"
          onClick={() => stopRecording(true)}
          className="rounded-md bg-slate-700 px-3 py-2 font-medium text-white transition hover:bg-slate-600"
        >
          ✕ Cancel
        </button>
        <span className="text-sm text-red-400">
          ● 🔒 {Math.floor(elapsedSeconds / 60)}:{String(elapsedSeconds % 60).padStart(2, "0")}
        </span>
        <button
          type="button"
          onClick={() => stopRecording()}
          className="rounded-md bg-violet-500 px-4 py-2 font-medium text-white transition hover:bg-violet-400"
        >
          Send ➤
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center">
      {recording && (
        <div
          className="mb-2 flex flex-col items-center text-xs text-slate-400 transition-transform"
          style={{ transform: `translateY(${-lockProgress * 12}px)`, opacity: 0.5 + lockProgress / 2 }}
        >
          <span className="text-lg">🔒</span>
          <span>Slide up to lock</span>
        </div>
      )}
      <button
        type="button"
        disabled={disabled || transcribing}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          pressStartYRef.current = event.clientY;
          void startRecording();
        }}
        onPointerMove={handlePointerMove}
        onPointerUp={handleRelease}
        onPointerCancel={handleRelease}
        onContextMenu={(event) => event.preventDefault()}
        onTouchStart={(event) => event.preventDefault()}
        title="Press and hold to speak; slide up to lock"
        className={
          "touch-none select-none [-webkit-touch-callout:none] [-webkit-tap-highlight-color:transparent] rounded-md px-3 py-2 font-medium text-white transition disabled:opacity-50 " +
          (recording ? "bg-red-500 hover:bg-red-400" : "bg-slate-700 hover:bg-slate-600")
        }
      >
        {recording ? "● Recording…" : transcribing ? "Transcribing…" : "🎤 Hold to speak"}
      </button>
      {error && <p className="mt-1 max-w-[12rem] text-center text-xs text-red-400">{error}</p>}
    </div>
  );
}
