import { describe, expect, it } from "vite-plus/test";

import { canStartAcpOperation, type AcpOperation } from "./AcpSessionManagementSection.logic";

const listing = { type: "listing" } as const;
const loadingProviders = { type: "loadingProviders" } as const;
const loggingOut = { type: "loggingOut" } as const;
const importing = (sessionId: string) => ({ type: "importing", sessionId }) as const;
const deleting = (sessionId: string) => ({ type: "deleting", sessionId }) as const;
const savingProvider = (providerId: string) => ({ type: "savingProvider", providerId }) as const;

describe("canStartAcpOperation", () => {
  it.each<[running: AcpOperation, next: AcpOperation]>([
    [importing("a"), deleting("a")],
    [deleting("a"), importing("a")],
    [importing("a"), importing("b")],
    [deleting("a"), deleting("b")],
    [listing, listing],
    [loadingProviders, loadingProviders],
    [loadingProviders, savingProvider("p")],
    [savingProvider("p"), loadingProviders],
    [savingProvider("p"), savingProvider("q")],
    [loggingOut, loggingOut],
  ])("while %j runs, %j cannot start", (running, next) => {
    expect(canStartAcpOperation([running], next)).toBe(false);
  });

  it.each<[running: AcpOperation, next: AcpOperation]>([
    [importing("a"), deleting("b")],
    [deleting("a"), importing("b")],
    [listing, importing("a")],
    [deleting("a"), listing],
    [listing, loadingProviders],
    [savingProvider("p"), importing("a")],
    [loggingOut, deleting("a")],
    [importing("a"), loggingOut],
  ])("while %j runs, %j can still start", (running, next) => {
    expect(canStartAcpOperation([running], next)).toBe(true);
  });
});
