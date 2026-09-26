// GitHub issue #7: Google access tokens expire after an hour, so the app refreshes a few
// minutes before that. Plain-assert style. Run: npm run test:driveToken
import assert from "node:assert/strict";
import { REFRESH_MARGIN_MS, tokenNeedsRefresh } from "./driveClient.ts";

const NOW = 1_000_000_000_000;
const session = (msLeft: number) => ({ accessToken: "t", expiresAt: NOW + msLeft });

assert.equal(tokenNeedsRefresh(session(60 * 60_000), NOW), false, "a fresh one-hour token is kept");
assert.equal(tokenNeedsRefresh(session(REFRESH_MARGIN_MS + 1), NOW), false, "just outside the margin is kept");
assert.equal(tokenNeedsRefresh(session(REFRESH_MARGIN_MS), NOW), true, "inside the margin is refreshed");
assert.equal(tokenNeedsRefresh(session(0), NOW), true, "expired now");
assert.equal(tokenNeedsRefresh(session(-5 * 60_000), NOW), true, "expired a while ago (app resumed after hours)");

console.log("driveToken.test.ts: all passed");
