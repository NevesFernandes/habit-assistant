// §33 in Roadmap.md: the shape of a chat scenario. A scenario loads a fixture
// (tests/chat/fixtures/<name>.json), then plays its turns through the same
// ChatSession the app uses, against a real model, checking each turn.
import type { AppData } from "../../src/types/models.ts";

export type TextMatch = string | RegExp;

export interface TurnExpect {
  /**
   * The tool the model chose for this turn (from its debug entry). An array accepts any of
   * them; null means the model must answer in plain text with no tool call.
   */
  toolCall?: string | string[] | null;
  /** The turn must be resolved by the app without calling the model (e.g. a §32 number pick). */
  noModelCall?: boolean;
  /** Every pattern must appear in the turn's reply text (all assistant messages, joined). */
  reply?: TextMatch | TextMatch[];
  /** None of these may appear in the reply. */
  notReply?: TextMatch | TextMatch[];
  /** A check on the stored data after the turn: return true, or a description of what's wrong. */
  data?: (data: AppData) => true | string;
}

export interface Turn {
  user: string;
  expect?: TurnExpect;
}

export interface Scenario {
  name: string;
  /** Fixture file name, without .json. */
  fixture: string;
  turns: Turn[];
}
