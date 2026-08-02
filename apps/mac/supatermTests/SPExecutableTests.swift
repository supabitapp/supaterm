import Foundation
import Testing

@testable import SPCLI

struct SPExecutableTests {
  @Test
  func namedResolutionTreatsEmptyPATHEntryAsCurrentDirectory() throws {
    let temporaryDirectory = try makeCommandExecutionTemporaryDirectory()
    defer { try? FileManager.default.removeItem(at: temporaryDirectory) }

    let executableURL = temporaryDirectory.appendingPathComponent("local-command", isDirectory: false)
    try writeExecutable(at: executableURL, script: "#!/bin/sh\nexit 0\n")

    let resolvedPath = SPExecutable.resolve(
      "local-command",
      searchPath: ":/tmp/does-not-exist",
      currentDirectoryPath: temporaryDirectory.path
    )

    #expect(resolvedPath == SPExecutable.normalizedPath(executableURL.path))
  }

  @Test
  func namedResolutionSkipsDirectories() throws {
    let temporaryDirectory = try makeCommandExecutionTemporaryDirectory()
    defer { try? FileManager.default.removeItem(at: temporaryDirectory) }

    let firstDirectory = temporaryDirectory.appendingPathComponent("first", isDirectory: true)
    let secondDirectory = temporaryDirectory.appendingPathComponent("second", isDirectory: true)
    try FileManager.default.createDirectory(
      at: firstDirectory.appendingPathComponent("tool", isDirectory: true),
      withIntermediateDirectories: true
    )
    let executableURL = secondDirectory.appendingPathComponent("tool", isDirectory: false)
    try writeExecutable(at: executableURL, script: "#!/bin/sh\nexit 0\n")

    let resolvedPath = SPExecutable.resolve(
      "tool",
      searchPath: "\(firstDirectory.path):\(secondDirectory.path)"
    )

    #expect(resolvedPath == SPExecutable.normalizedPath(executableURL.path))
  }

  @Test
  func explicitResolutionNormalizesSymlinks() throws {
    let temporaryDirectory = try makeCommandExecutionTemporaryDirectory()
    defer { try? FileManager.default.removeItem(at: temporaryDirectory) }

    let executableURL = temporaryDirectory.appendingPathComponent("tool-real", isDirectory: false)
    let symlinkURL = temporaryDirectory.appendingPathComponent("tool", isDirectory: false)
    try writeExecutable(at: executableURL, script: "#!/bin/sh\nexit 0\n")
    try FileManager.default.createSymbolicLink(at: symlinkURL, withDestinationURL: executableURL)

    #expect(
      SPExecutable.resolve(symlinkURL.path)
        == SPExecutable.normalizedPath(executableURL.path)
    )
  }
}
