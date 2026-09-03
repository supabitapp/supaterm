from __future__ import annotations

import re
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
REMOTE_ACTION_PATTERN = re.compile(r"^\s*-?\s*uses:\s*['\"]?([^\s'\"#]+)")
FULL_COMMIT_SHA_PATTERN = re.compile(r"^[0-9a-f]{40}$")


def workflow_files() -> list[Path]:
  workflow_directory = REPO_ROOT / ".github/workflows"
  return sorted((*workflow_directory.glob("*.yml"), *workflow_directory.glob("*.yaml")))


class WorkflowPolicyTests(unittest.TestCase):
  def test_remote_actions_are_pinned_to_full_commit_shas(self) -> None:
    mutable_references = []
    for path in workflow_files():
      for line_number, line in enumerate(path.read_text().splitlines(), start=1):
        match = REMOTE_ACTION_PATTERN.match(line)
        if match is None:
          continue
        reference = match.group(1)
        if reference.startswith(("./", "docker://")):
          continue
        _, separator, revision = reference.rpartition("@")
        if not separator or FULL_COMMIT_SHA_PATTERN.fullmatch(revision) is None:
          relative_path = path.relative_to(REPO_ROOT)
          mutable_references.append(f"{relative_path}:{line_number}: {reference}")

    self.assertEqual(
      mutable_references,
      [],
      "remote actions must use full commit SHAs:\n" + "\n".join(mutable_references),
    )


if __name__ == "__main__":
  unittest.main()
