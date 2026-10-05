// §51: what the chat shows when the last provider in the chain refused a request. Provider
// error bodies are raw JSON not meant for users, so they are never forwarded; but "your
// request was too large" and "you hit a rate limit" are things the user can act on, where
// the old one-size message ("had a problem answering") was not.

const PROVIDER_NAMES: Record<string, string> = {
  groq: "Groq",
  gemini: "Gemini",
  anthropic: "Anthropic",
  workersAI: "Cloudflare Workers AI",
};

export const GENERIC_PROVIDER_ERROR = "The assistant provider had a problem answering. Please try again in a moment.";

/**
 * §48: the provider refused the API key itself (wrong, revoked or deleted), as opposed to
 * the request. Groq, Anthropic and Workers AI answer 401/403; Gemini answers 400 with
 * `API_KEY_INVALID` ("API key not valid…"), so a 400 counts only with that text.
 */
export function isKeyRejected(status: number, rawMessage: string): boolean {
  if (status === 401 || status === 403) return true;
  return status === 400 && /API_KEY_INVALID|API key not valid/i.test(rawMessage);
}

/**
 * `rawMessage` is the provider's own error text, read only to recognise the case.
 * `usingOwnKey` is false on the shared trial, where the user can't do anything about the
 * operator's limits — chatEngine's §40 hint covers that — so the generic text stays.
 */
export function providerErrorMessage(status: number, rawMessage: string, providerId: string, usingOwnKey: boolean): string {
  if (!usingOwnKey) return GENERIC_PROVIDER_ERROR;
  const name = PROVIDER_NAMES[providerId] ?? "the provider";

  // Groq answers 413 when one request alone is over its tokens-per-minute limit.
  if (status === 413 || /request too large/i.test(rawMessage)) {
    const base = `That request was too large for ${name}${providerId === "groq" ? "'s free tier" : ""}. Try saying it with a clear action word (add, change, delete, mark done), or wait a minute and try again.`;
    return providerId === "groq" ? `${base} Gemini's free tier has no such limit: you can switch in Settings (⚙).` : base;
  }
  if (isKeyRejected(status, rawMessage)) {
    return `Your ${name === "the provider" ? "API" : name} key was rejected. Check it in Settings (⚙).`;
  }
  if (status === 429) {
    const subject = name === "the provider" ? "The provider's" : `${name}'s`;
    return `${subject} rate limit was reached. Wait a minute and try again.`;
  }
  return GENERIC_PROVIDER_ERROR;
}
