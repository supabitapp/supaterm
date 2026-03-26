/**
 * Pi Notify Extension
 *
 * Sends a native terminal notification when Pi agent is done and waiting for input.
 * Uses OSC 777 escape sequence supported by Ghostty, iTerm2, and other modern terminals.
 *
 * Click the notification to focus the terminal tab/window.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { AssistantMessage, TextContent } from "@mariozechner/pi-ai";

/**
 * Send a desktop notification via OSC 777 escape sequence.
 * Supported by: Ghostty, iTerm2, rxvt-unicode, and others.
 */
function notify(title: string, body: string): void {
  // OSC 777 format: ESC ] 777 ; notify ; title ; body BEL
  // Sanitize to avoid breaking the escape sequence delimiters (;)
  const sTitle = title.replace(/;/g, ":").replace(/\n/g, " ").trim();
  const sBody = body.replace(/;/g, ":").replace(/\n/g, " ").trim();
  process.stdout.write(`\x1b]777;notify;${sTitle};${sBody}\x07`);
}

function formatDuration(ms: number): string | null {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return null;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h${remainingMinutes > 0 ? `${remainingMinutes}m` : ""}`;
}

function cleanModelName(name: string): string {
  return name
    .replace(/\s*\(.*?\)/g, "") // Remove (...)
    .replace(/High|Medium|Low/g, (m) => m[0]) // Shorten thinking level
    .trim();
}

export default function (pi: ExtensionAPI) {
  let startTime = 0;
  let toolCalls = 0;
  let hasError = false;
  let errorTool: string | undefined;
  let lastAction: string | undefined;

  pi.on("agent_start", async () => {
    startTime = Date.now();
    toolCalls = 0;
    hasError = false;
    errorTool = undefined;
    lastAction = undefined;
  });

  pi.on("tool_call", async (event) => {
    toolCalls++;
    
    // Capture a summary of the action
    if (event.toolName === "bash" && typeof event.input.command === "string") {
      lastAction = `💻 ${event.input.command.split("\n")[0]}`;
    } else if ((event.toolName === "write" || event.toolName === "edit") && typeof event.input.path === "string") {
      lastAction = `📝 ${event.input.path.split("/").pop()}`;
    }
  });

  pi.on("tool_result", async (event) => {
    if (event.isError) {
      hasError = true;
      errorTool = event.toolName;
    }
  });

  pi.on("agent_end", async (event, ctx) => {
    const durationStr = formatDuration(Date.now() - startTime);
    const modelName = ctx.model?.name ?? "Pi";
    const sessionName = pi.getSessionName();
    
    // Find last assistant message to get a snippet of the response
    const lastAssistantMessage = [...event.messages]
      .reverse()
      .find((m): m is AssistantMessage => m.role === "assistant");

    let snippet = "Ready for input";
    let isTruncated = false;

    if (lastAssistantMessage) {
      const text = lastAssistantMessage.content
        .filter((c): c is TextContent => c.type === "text")
        .map((c) => c.text)
        .join(" ");

      if (text.length > 0) {
        snippet = text.length > 120 ? text.substring(0, 117) + "..." : text;
      }
      
      if (lastAssistantMessage.stopReason === "length") {
        isTruncated = true;
      }
    }

    let status = hasError ? "❌ " : "✅ ";
    if (isTruncated && !hasError) {
      status = "⚠️ ";
    }
    
    // Put duration first so it's never truncated (if present)
    const titlePrefix = durationStr ? `(${durationStr}) ` : "";
    const title = `${status}${titlePrefix}Pi: ${cleanModelName(modelName)}`;
    
    const meta: string[] = [];
    
    // Project name removed (redundant with window subtitle)

    if (lastAction) {
      const displayAction = lastAction.length > 30 ? lastAction.substring(0, 29) + "…" : lastAction;
      meta.push(displayAction);
    }
    
    if (toolCalls > 0) meta.push(`${toolCalls} ops`);
    if (hasError && errorTool) meta.push(`${errorTool} ❌`);
    if (isTruncated) meta.push("trunc ⚠️");
    if (sessionName) meta.push(sessionName);
    
    // Put meta first in body to ensure visibility
    const body = meta.length > 0 ? `[${meta.join(" · ")}] ${snippet}` : snippet;

    notify(title, body);
  });
}
