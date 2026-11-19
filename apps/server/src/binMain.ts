import { enableCliCompileCache } from "./cliCompileCache.ts";

export async function runCliCommand() {
  const command = process.argv[2];
  const { ignoreMacosTypeOfServiceEinval } = await import("./outboundHttp.ts");
  ignoreMacosTypeOfServiceEinval();
  if (command === "__document-text") {
    const { extractDocumentText } = await import("./provider/documentTextWorker.ts");
    try {
      process.stdout.write(await extractDocumentText(process.argv[3]!, process.argv[4]!));
    } catch (error) {
      if (error instanceof Error && "code" in error && /^E[A-Z0-9]+$/.test(String(error.code))) {
        throw error;
      }
      process.exitCode = 2;
    }
  } else if (command === "__managed-chatgpt-token") {
    const { runManagedChatGptTokenCli } = await import("./cli/managedChatGptToken.ts");
    await runManagedChatGptTokenCli(process.argv.slice(3));
  } else if (command === "acp-mcp-bridge" || command === "acp-mcp-call") {
    const { runAcpMcpCliFastPath } = await import("./mcp/AcpMcpStdioBridge.ts");
    await runAcpMcpCliFastPath(command, process.argv.slice(3));
  } else {
    enableCliCompileCache();
    const { attachConsoleStdin } = await import("./cli/consoleStdin.ts");
    attachConsoleStdin();
    const importStart = performance.now();
    const { runCli } = await import("./binCli.ts");
    if (process.env.SUPATERM_STARTUP_PROFILE_DIR) {
      performance.measure("server.import.binCli", { start: importStart });
    }
    runCli();
  }
}
