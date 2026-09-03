#!/usr/bin/env python3
"""Run a project's exactly pinned Vite+ CLI."""

from __future__ import annotations

import json
import os
from pathlib import Path
import re
import sys


EXACT_VERSION = re.compile(r"^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$")


class VitePlusConfigError(ValueError):
    """Raised when a project does not reproducibly pin Vite+."""


def resolve_version(project_dir: Path) -> str:
    package_path = project_dir / "package.json"
    lock_path = project_dir / "pnpm-lock.yaml"

    try:
        package = json.loads(package_path.read_text())
    except (OSError, json.JSONDecodeError) as error:
        raise VitePlusConfigError(f"unable to read {package_path}: {error}") from error

    versions = []
    for group in ("dependencies", "devDependencies"):
        dependencies = package.get(group)
        if isinstance(dependencies, dict) and "vite-plus" in dependencies:
            versions.append(dependencies["vite-plus"])
    if len(versions) != 1:
        raise VitePlusConfigError(
            f"{package_path} must declare one exact vite-plus version"
        )

    version = versions[0]
    if not isinstance(version, str) or not EXACT_VERSION.fullmatch(version):
        raise VitePlusConfigError(
            f"{package_path} must pin vite-plus to an exact semantic version"
        )

    try:
        lock = lock_path.read_text()
    except OSError as error:
        raise VitePlusConfigError(f"unable to read {lock_path}: {error}") from error

    if not re.search(rf"^  vite-plus@{re.escape(version)}:$", lock, re.MULTILINE):
        raise VitePlusConfigError(
            f"{lock_path} does not lock the vite-plus version {version} from package.json"
        )

    return version


def mise_command(version: str, arguments: list[str]) -> list[str]:
    return ["mise", "exec", f"npm:vite-plus@{version}", "--", "vp", *arguments]


def vite_plus_command(
    project_dir: Path, version: str, arguments: list[str]
) -> list[str]:
    local_vite_plus = project_dir / "node_modules" / ".bin" / "vp"
    if arguments[0] != "install" and local_vite_plus.is_file():
        return [str(local_vite_plus), *arguments]
    return mise_command(version, arguments)


def main(arguments: list[str]) -> int:
    print_version = bool(arguments and arguments[0] == "--print-version")
    if print_version:
        arguments = arguments[1:]

    if not arguments or (not print_version and len(arguments) < 2):
        print(
            "usage: vite_plus.py [--print-version] PROJECT_DIR [VP_ARGUMENT ...]",
            file=sys.stderr,
        )
        return 2

    project_dir = Path(arguments[0]).resolve()
    try:
        version = resolve_version(project_dir)
    except VitePlusConfigError as error:
        print(f"error: {error}", file=sys.stderr)
        return 2

    if print_version:
        print(version)
        return 0

    command = vite_plus_command(project_dir, version, arguments[1:])
    os.chdir(project_dir)
    os.execvp(command[0], command)


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
