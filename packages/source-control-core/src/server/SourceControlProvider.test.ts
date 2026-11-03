import { assert, it } from "@effect/vitest";

import {
  repositoryPathFromRemoteUrl,
  transportSafeSourceControlErrorValue,
} from "./SourceControlProvider.ts";

it("removes URL credentials, query parameters, and fragments from error transport values", () => {
  assert.strictEqual(
    transportSafeSourceControlErrorValue(
      "https://user:secret@example.test/org/repo/pull/42?token=secret#discussion",
    ),
    "https://example.test/org/repo/pull/42",
  );
});

it.each([
  ["git@github.com:SupatermTools/supaterm.git", "SupatermTools/supaterm"],
  ["github.com:SupatermTools/supaterm.git", "SupatermTools/supaterm"],
  ["gitlab.com:SupatermTools/platform/supaterm", "SupatermTools/platform/supaterm"],
  ["https://github.com/SupatermTools/supaterm.git", "SupatermTools/supaterm"],
  ["C:/repos/supaterm", null],
])("reads the repository path of %s", (remoteUrl, expected) => {
  assert.strictEqual(repositoryPathFromRemoteUrl(remoteUrl), expected);
});
