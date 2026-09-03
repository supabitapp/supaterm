import json
from pathlib import Path
import tempfile
import unittest
from typing import Optional

from vite_plus import (
    VitePlusConfigError,
    mise_command,
    resolve_version,
    vite_plus_command,
)


class ResolveVersionTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.project_dir = Path(self.temporary_directory.name)

    def tearDown(self) -> None:
        self.temporary_directory.cleanup()

    def write_project(self, version: str, locked_version: Optional[str] = None) -> None:
        package = {"devDependencies": {"vite-plus": version}}
        (self.project_dir / "package.json").write_text(json.dumps(package))
        locked_version = locked_version or version
        (self.project_dir / "pnpm-lock.yaml").write_text(
            f"lockfileVersion: '9.0'\n\npackages:\n\n  vite-plus@{locked_version}:\n"
        )

    def test_resolves_exact_version_present_in_lock(self) -> None:
        self.write_project("0.1.13")

        self.assertEqual(resolve_version(self.project_dir), "0.1.13")

    def test_rejects_version_ranges(self) -> None:
        self.write_project("^0.1.13")

        with self.assertRaisesRegex(VitePlusConfigError, "exact semantic version"):
            resolve_version(self.project_dir)

    def test_rejects_manifest_and_lock_mismatch(self) -> None:
        self.write_project("0.1.13", locked_version="0.1.24")

        with self.assertRaisesRegex(VitePlusConfigError, "does not lock"):
            resolve_version(self.project_dir)

    def test_mise_command_selects_requested_version(self) -> None:
        self.assertEqual(
            mise_command("0.1.24", ["run", "build"]),
            [
                "mise",
                "exec",
                "npm:vite-plus@0.1.24",
                "--",
                "vp",
                "run",
                "build",
            ],
        )

    def test_uses_installed_project_cli_for_commands(self) -> None:
        local_vite_plus = self.project_dir / "node_modules" / ".bin" / "vp"
        local_vite_plus.parent.mkdir(parents=True)
        local_vite_plus.touch()

        self.assertEqual(
            vite_plus_command(self.project_dir, "0.1.13", ["test"]),
            [str(local_vite_plus), "test"],
        )

    def test_uses_mise_to_install_even_when_project_cli_exists(self) -> None:
        local_vite_plus = self.project_dir / "node_modules" / ".bin" / "vp"
        local_vite_plus.parent.mkdir(parents=True)
        local_vite_plus.touch()

        self.assertEqual(
            vite_plus_command(self.project_dir, "0.1.13", ["install"]),
            mise_command("0.1.13", ["install"]),
        )


if __name__ == "__main__":
    unittest.main()
