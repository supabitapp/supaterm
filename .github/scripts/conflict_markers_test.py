import re
import subprocess
import unittest
from pathlib import Path


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
EXCLUDED_DIRECTORIES = {"fixtures", "vendor"}
CONFLICT_MARKER = re.compile(
    rb"^(?:<{7}(?: .*)?|\|{7}(?: .*)?|={7}|>{7}(?: .*)?)$"
)


class ConflictMarkersTest(unittest.TestCase):
    def test_tracked_files_do_not_contain_conflict_markers(self) -> None:
        tracked_files = subprocess.run(
            ["git", "ls-files", "-z"],
            cwd=REPOSITORY_ROOT,
            check=True,
            capture_output=True,
        ).stdout.split(b"\0")

        matches: list[str] = []
        for raw_path in tracked_files:
            if not raw_path:
                continue

            relative_path = Path(raw_path.decode(errors="surrogateescape"))
            if EXCLUDED_DIRECTORIES.intersection(relative_path.parts):
                continue

            path = REPOSITORY_ROOT / relative_path
            if not path.is_file():
                continue

            for line_number, line in enumerate(path.read_bytes().splitlines(), start=1):
                if CONFLICT_MARKER.fullmatch(line):
                    matches.append(f"{relative_path}:{line_number}")

        self.assertEqual([], matches, f"merge conflict markers found: {', '.join(matches)}")


if __name__ == "__main__":
    unittest.main()
