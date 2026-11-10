export type AcpOperation =
  | { readonly type: "listing" }
  | { readonly type: "importing"; readonly sessionId: string }
  | { readonly type: "deleting"; readonly sessionId: string }
  | { readonly type: "loadingProviders" }
  | { readonly type: "savingProvider"; readonly providerId: string }
  | { readonly type: "loggingOut" };

function blocks(running: AcpOperation, next: AcpOperation): boolean {
  switch (next.type) {
    case "listing":
    case "loggingOut":
      return running.type === next.type;
    case "importing":
    case "deleting":
      return (
        (running.type === "importing" || running.type === "deleting") &&
        (running.type === next.type || running.sessionId === next.sessionId)
      );
    case "loadingProviders":
    case "savingProvider":
      return running.type === "loadingProviders" || running.type === "savingProvider";
  }
}

export function canStartAcpOperation(running: ReadonlyArray<AcpOperation>, next: AcpOperation) {
  return !running.some((operation) => blocks(operation, next));
}
