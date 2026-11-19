import type { AcpRegistrySettings } from "../settings.ts";

const COMMAND_CODE_EXECUTABLES = /^(?:cmdc|command-code|commandcode)(?:\.exe)?$/iu;
const COMMAND_CODE_ENTRY_POINTS = [
  /(?:^|[\\/])node_modules[\\/]command-code[\\/]/iu,
  /(?:^|[\\/])command-code[\\/]dist[\\/](?:index|cli)\.mjs$/iu,
];

/**
 * Agents that take Supaterm's MCP endpoint over ACP HTTP: Command Code cannot start the stdio
 * bridge on Windows, where it spawns MCP commands through cmd.exe and an unquoted Supaterm
 * executable path splits at a space.
 */
export function prefersHttpMcpTransport(settings: AcpRegistrySettings) {
  if (settings.source !== "local") {
    return false;
  }
  const executable = settings.commandPath.split(/[\\/]/u).pop() ?? "";
  return (
    COMMAND_CODE_EXECUTABLES.test(executable) ||
    settings.commandArgs.some((argument) =>
      COMMAND_CODE_ENTRY_POINTS.some((pattern) => pattern.test(argument)),
    )
  );
}
