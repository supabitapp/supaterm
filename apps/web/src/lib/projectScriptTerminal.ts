export function findReusableProjectScriptTerminal(input: {
  readonly drawerTerminalIds: ReadonlyArray<string>;
  readonly activeTerminalId: string;
  readonly panelTerminalIds: ReadonlySet<string>;
  readonly runningTerminalIds: ReadonlyArray<string>;
  /** A pending close would end the script's shell once the reopen runs. */
  readonly closingTerminalIds: ReadonlyArray<string>;
}) {
  const idleDrawerTerminalIds = input.drawerTerminalIds.filter(
    (terminalId) =>
      !input.panelTerminalIds.has(terminalId) &&
      !input.runningTerminalIds.includes(terminalId) &&
      !input.closingTerminalIds.includes(terminalId),
  );
  if (idleDrawerTerminalIds.includes(input.activeTerminalId)) return input.activeTerminalId;
  return idleDrawerTerminalIds[0] ?? null;
}
