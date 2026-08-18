import { useRef, useState } from "react";
import { transcribeAudio } from "../lib/transcribeClient";

interface VoiceButtonProps {
  sttApiKey: string | null;
  disabled: boolean;
  onTranscribed: (text: string) => void;
}

const CANDIDATE_MIME_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];

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
    if (blob.size === 0) return;

    setTranscribing(true);
    try {
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
        title="Press and hold to speak"
        className={
          "rounded-md px-3 py-2 font-medium text-white transition disabled:opacity-50 " +
          (recording ? "bg-red-500 hover:bg-red-400" : "bg-slate-700 hover:bg-slate-600")
        }
      >
        {recording ? "● Recording…" : transcribing ? "Transcribing…" : "🎤 Hold to speak"}
      </button>
      {error && <p className="mt-1 max-w-[12rem] text-center text-xs text-red-400">{error}</p>}
    </div>
  );
}
