import { SERVICE_LAUNCHER_CONTEXT_ENV } from "../service/serviceProtocol.ts";

for (const name of ["SUPATERM_HOME", "SUPATERM_BOOT_SERVICE_UNIT", SERVICE_LAUNCHER_CONTEXT_ENV]) {
  delete process.env[name];
}
