import packageJson from "../../package.json" with { type: "json" };
import { recordedMigrations } from "../persistence/databaseMigrationHead.ts";
import { migrationManifest } from "../persistence/Migrations.ts";
import { SERVICE_LAUNCHER_PROTOCOL } from "./serviceProtocol.ts";

export type ServicePreflightResult =
  | {
      readonly status: "ready";
      readonly version: string;
      readonly launcherProtocol: typeof SERVICE_LAUNCHER_PROTOCOL;
    }
  | {
      readonly status: "blocked";
      readonly version: string;
      readonly reason: string;
    };

export function runServicePreflight(input: {
  readonly launcherProtocol: number;
  readonly version?: string;
  readonly databasePath?: string;
}): ServicePreflightResult {
  const version = input.version ?? packageJson.version;
  if (input.launcherProtocol !== SERVICE_LAUNCHER_PROTOCOL) {
    return {
      status: "blocked",
      version,
      reason: [
        `The installed service launcher speaks protocol ${input.launcherProtocol}, but supaterm@${version} requires protocol ${SERVICE_LAUNCHER_PROTOCOL}.`,
        `On the server machine, install this exact CLI: \`curl -fsSL https://supaterm.com/install.sh | SUPATERM_VERSION=${version} sh\`.`,
        `Check that \`supaterm --version\` prints ${version} and that \`which -a supaterm\` lists no older CLI first, then run \`~/.local/bin/supaterm service install\` (the installer's default path).`,
        "Updating the desktop app does not update this CLI. `supaterm update` installs a CLI version; `supaterm service restart` starts that installed version.",
      ].join(" "),
    };
  }

  if (input.databasePath !== undefined) {
    const recorded = recordedMigrations(input.databasePath);
    const known = new Map<number, string>(migrationManifest);
    const head = Math.max(0, ...(recorded ?? []).map(({ id }) => id));
    if (
      recorded === null ||
      new Set(recorded.map(({ id }) => id)).size !== recorded.length ||
      recorded.some(({ id, name }) => known.get(id) !== name) ||
      migrationManifest.some(
        ([id, name]) =>
          id <= head && !recorded.some((entry) => entry.id === id && entry.name === name),
      )
    ) {
      return {
        status: "blocked",
        version,
        reason: `The database migration history is not compatible with supaterm@${version}. Keep the current release until the target supports this history.`,
      };
    }
  }

  return { status: "ready", version, launcherProtocol: SERVICE_LAUNCHER_PROTOCOL };
}

export function decodeServicePreflightResult(value: unknown): ServicePreflightResult | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (
    record.status === "ready" &&
    record.launcherProtocol === SERVICE_LAUNCHER_PROTOCOL &&
    typeof record.version === "string"
  ) {
    return {
      status: "ready",
      version: record.version,
      launcherProtocol: SERVICE_LAUNCHER_PROTOCOL,
    };
  }
  if (
    record.status === "blocked" &&
    typeof record.version === "string" &&
    typeof record.reason === "string"
  ) {
    return { status: "blocked", version: record.version, reason: record.reason };
  }
  return undefined;
}
