#!/usr/bin/env bash
# Run the process-table regression tests or benchmark without Tuist/submodules.
set -euo pipefail

mode="${1:-test}"
case "$mode" in
  test|benchmark) ;;
  *) echo "usage: $0 [test|benchmark]" >&2; exit 2 ;;
esac
mac_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
package_dir="$(mktemp -d "${TMPDIR:-/tmp}/supaterm-process-tree.XXXXXX")"
trap 'rm -rf "$package_dir"' EXIT
mkdir -p "$package_dir/Sources/SupatermSupport" "$package_dir/Tests/SupatermSupportTests"
cat > "$package_dir/Package.swift" <<'PACKAGE'
// swift-tools-version: 6.2
import PackageDescription
let package = Package(
  name: "ProcessTreeVerification",
  platforms: [.macOS(.v26)],
  targets: [
    .executableTarget(name: "SupatermSupport"),
    .testTarget(name: "SupatermSupportTests", dependencies: ["SupatermSupport"]),
  ]
)
PACKAGE
for source in ProcessTable TerminalAgentProcessIdentity TerminalAgentProcessTreeSnapshot; do
  ln -s "$mac_root/supaterm/Support/$source.swift" "$package_dir/Sources/SupatermSupport/$source.swift"
done
ln -s "$mac_root/supatermTests/ProcessTableTests.swift" "$package_dir/Tests/SupatermSupportTests/ProcessTableTests.swift"
ln -s "$mac_root/benchmarks/ProcessTreeBenchmark.swift" "$package_dir/Sources/SupatermSupport/ProcessTreeBenchmark.swift"
if [ "$mode" = test ]; then
  swift test --package-path "$package_dir"
else
  swift run --package-path "$package_dir" -c release SupatermSupport
fi
