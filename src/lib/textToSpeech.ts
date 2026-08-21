// Text-to-speech via the browser's built-in SpeechSynthesis API — no server
// call, no API key, mirroring the project's zero-cost-by-construction model.
// Unlike speech *recognition* (used for voice input), this half of the Web
// Speech API isn't the one CLAUDE.md found broken on installed iOS PWAs, so
// it's used directly rather than proxied through a cloud provider.

export function isTtsSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

export function speak(text: string): void {
  if (!isTtsSupported() || !text.trim()) return;
  window.speechSynthesis.cancel(); // interrupt any utterance still in flight
  const utterance = new SpeechSynthesisUtterance(text);
  window.speechSynthesis.speak(utterance);
}

export function cancelSpeech(): void {
  if (isTtsSupported()) window.speechSynthesis.cancel();
}
