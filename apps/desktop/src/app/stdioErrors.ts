import * as NodeOS from "node:os";

const EDQUOT_ERRNO = NodeOS.constants.errno.EDQUOT;

export function handleStdioError(error: unknown): void {
  if (typeof error === "object" && error !== null) {
    if ("code" in error && (error.code === "EPIPE" || error.code === "ENOSPC")) return;
    if (EDQUOT_ERRNO !== undefined && "errno" in error && error.errno === -EDQUOT_ERRNO) return;
  }
  throw error;
}
