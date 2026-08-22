import { useRef, useState } from "react";
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

function pickSupportedMimeType(): string | undefined {
  return CANDIDATE_MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
}

export default function VoiceButton({ sttApiKey, disabled, onTranscribed }: VoiceButtonProps) {
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const startTimeRef = useRef(0);

  async function startRecording() {
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

  function stopRecording() {
    if (!recording) return;
    recorderRef.current?.stop();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    setRecording(false);
  }

  async function handleStopped(mimeType: string) {
    const blob = new Blob(chunksRef.current, { type: mimeType });
    chunksRef.current = [];

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

  return (
    <div className="flex flex-col items-center">
      <button
        type="button"
        disabled={disabled || transcribing}
        onPointerDown={startRecording}
        onPointerUp={stopRecording}
        onPointerLeave={stopRecording}
        onPointerCancel={stopRecording}
        onContextMenu={(event) => event.preventDefault()}
        title="Press and hold to speak"
        className={
          "touch-none rounded-md px-3 py-2 font-medium text-white transition disabled:opacity-50 " +
          (recording ? "bg-red-500 hover:bg-red-400" : "bg-slate-700 hover:bg-slate-600")
        }
      >
        {recording ? "● Recording…" : transcribing ? "Transcribing…" : "🎤 Hold to speak"}
      </button>
      {error && <p className="mt-1 max-w-[12rem] text-center text-xs text-red-400">{error}</p>}
    </div>
  );
}
