// The MCP server: tool definitions and the per-request transport. Auth and Drive are
// injected (McpDeps), so tests drive this file with a fake file and no Google at all.
//
// A new McpServer and transport per request, never a module-level one: a shared instance
// can send one user's response to another (MCP SDK 1.26.0 advisory).
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { CfWorkerJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/cfworker-provider.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { AppData } from "../types/models.ts";
import { getDay } from "./getDay.ts";
import { isISODate, isValidTimeZone, todayIn } from "./today.ts";
import { DriveAccessError, DriveFileNotFoundError } from "./drive.ts";

export interface McpDeps {
  loadData: () => Promise<AppData>;
  log?: (event: Record<string, unknown>) => void;
}

const INSTRUCTIONS = `Habit Assistant: the user's habits, recurring tasks and one-off tasks, stored in their own Google Drive and shared with the Habit Assistant app.
Act directly; ask a question only when a tool can't run without the answer.
Present days grouped by part of the day (Wake-up, Morning, Work day, Afternoon, Evening, Bedtime), in the order the tool returns them; important items carry a star.`;

const GET_DAY_DESCRIPTION = `What the user has on a given day: habits, recurring tasks and one-off tasks that are due, grouped by part of the day, in the same order as the app's Today tab, with what's done, logged amounts, checklist progress and "N times a week" progress.
Pass \`date\` as the user's local date (YYYY-MM-DD) whenever you know it, and \`timeZone\` (IANA, e.g. "Europe/Lisbon") when you know it too: with it, unfinished one-off tasks from earlier days roll forward to today, as in the app.
If the result's status is "need_timezone", ask the user which city or time zone they're in, then call again with \`timeZone\`.
Reply briefly: list what's left first, then what's done; mention a part of the day only when it has items. Never invent items that aren't in the result.`;

function json(value: unknown, isError = false): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value) }], ...(isError ? { isError: true } : {}) };
}

function driveFailure(error: unknown): CallToolResult | undefined {
  if (error instanceof DriveFileNotFoundError) {
    return json({
      status: "no_data_file",
      message:
        "No Habit Assistant data is visible in this Google Drive. Ask the user to open https://habitassistant.app once with the same Google account, then try again.",
    });
  }
  if (error instanceof DriveAccessError) {
    return json(
      {
        status: "drive_access_denied",
        message: "Google Drive refused access. Ask the user to disconnect and reconnect Habit Assistant in Claude's connector settings.",
      },
      true,
    );
  }
  return undefined;
}

export function buildServer(deps: McpDeps): McpServer {
  const server = new McpServer(
    { name: "habit-assistant", version: "0.1.0" },
    { instructions: INSTRUCTIONS, jsonSchemaValidator: new CfWorkerJsonSchemaValidator() },
  );

  server.registerTool(
    "get_day",
    {
      title: "Get a day",
      description: GET_DAY_DESCRIPTION,
      inputSchema: {
        date: z.string().optional().describe("The day to show, YYYY-MM-DD, in the user's local calendar. Defaults to today in `timeZone`."),
        timeZone: z.string().optional().describe('The user\'s IANA time zone, e.g. "Europe/Lisbon".'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ date, timeZone }) => {
      const started = Date.now();
      let status = "ok";
      try {
        if (date !== undefined && !isISODate(date)) {
          status = "invalid_date";
          return json({ status, message: `"${date}" is not a YYYY-MM-DD date.` }, true);
        }
        if (timeZone !== undefined && !isValidTimeZone(timeZone)) {
          status = "invalid_time_zone";
          return json({ status, message: `"${timeZone}" is not an IANA time zone name.` }, true);
        }
        const today = timeZone ? todayIn(timeZone) : undefined;
        const target = date ?? today;
        if (!target) {
          status = "need_timezone";
          return json({ status, message: "Pass `date`, or ask the user for their time zone and pass `timeZone`." });
        }
        const data = await deps.loadData();
        return json({ status, ...getDay(data, target, today) });
      } catch (error) {
        const failure = driveFailure(error);
        status = failure ? "drive_error" : "error";
        if (failure) return failure;
        throw error;
      } finally {
        deps.log?.({ tool: "get_day", status, ms: Date.now() - started });
      }
    },
  );

  return server;
}

/** Answers one MCP HTTP request (streamable HTTP, stateless, JSON responses). */
export async function handleMcpRequest(request: Request, deps: McpDeps): Promise<Response> {
  const server = buildServer(deps);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  return transport.handleRequest(request);
}
