import {
  AcpRegistryDriver,
  type AcpRegistryDriverEnv,
} from "@supaterm/provider-acp-registry/server";
import { AntigravityDriver, type AntigravityDriverEnv } from "./Drivers/AntigravityDriver.ts";
import { ClaudeDriver, type ClaudeDriverEnv } from "./Drivers/ClaudeDriver.ts";
import { CodexDriver, type CodexDriverEnv } from "./Drivers/CodexDriver.ts";
import { CursorDriver, type CursorDriverEnv } from "@supaterm/provider-cursor/server";
import { GrokDriver, type GrokDriverEnv } from "@supaterm/provider-grok/server";
import { OpenCodeDriver, type OpenCodeDriverEnv } from "@supaterm/provider-opencode/server";
import { MuseDriver, type MuseDriverEnv } from "@supaterm/provider-muse/server";
import { PiDriver, type PiDriverEnv } from "@supaterm/provider-pi/server";
import type {
  AnyProviderDriver,
  ProviderUsageReaderEnv,
} from "@supaterm/provider-core/server/driver";

export type BuiltInDriversEnv =
  | AcpRegistryDriverEnv
  | AntigravityDriverEnv
  | ClaudeDriverEnv
  | CodexDriverEnv
  | CursorDriverEnv
  | GrokDriverEnv
  | OpenCodeDriverEnv
  | PiDriverEnv
  | MuseDriverEnv;

export const BUILT_IN_DRIVERS: ReadonlyArray<AnyProviderDriver<BuiltInDriversEnv>> = [
  CodexDriver,
  ClaudeDriver,
  CursorDriver,
  GrokDriver,
  OpenCodeDriver,
  AntigravityDriver,
  PiDriver,
  MuseDriver,
  AcpRegistryDriver,
];

export type BuiltInUsageReadersEnv =
  | ProviderUsageReaderEnv<typeof ClaudeDriver>
  | ProviderUsageReaderEnv<typeof CodexDriver>
  | ProviderUsageReaderEnv<typeof GrokDriver>
  | ProviderUsageReaderEnv<typeof OpenCodeDriver>
  | ProviderUsageReaderEnv<typeof AntigravityDriver>
  | ProviderUsageReaderEnv<typeof CursorDriver>
  | ProviderUsageReaderEnv<typeof PiDriver>;

/**
 * Aggregation keeps the first copy of a duplicate record, so the order is part
 * of the result.
 */
export const BUILT_IN_USAGE_DRIVERS: ReadonlyArray<
  AnyProviderDriver<BuiltInDriversEnv, BuiltInUsageReadersEnv>
> = [
  ClaudeDriver,
  CodexDriver,
  GrokDriver,
  PiDriver,
  OpenCodeDriver,
  AntigravityDriver,
  CursorDriver,
];
