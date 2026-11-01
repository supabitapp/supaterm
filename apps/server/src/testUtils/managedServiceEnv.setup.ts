import { SERVICE_LAUNCHER_CONTEXT_ENV } from "../service/serviceProtocol.ts";

// Agents inside a managed Supaterm service inherit its home and launcher context; CI has neither.
for (const name of ["SUPATERM_HOME", "SUPATERM_BOOT_SERVICE_UNIT", SERVICE_LAUNCHER_CONTEXT_ENV]) {
  delete process.env[name];
}
