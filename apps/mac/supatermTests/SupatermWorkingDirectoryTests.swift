import Foundation
import SupatermCLIShared
import Testing

struct SupatermWorkingDirectoryTests {
  @Test
  func normalizesPathSeparators() {
    #expect(SupatermWorkingDirectory.normalizedPath("/tmp/example/") == "/tmp/example")
    #expect(SupatermWorkingDirectory.normalizedPath("/tmp//example///") == "/tmp/example")
    #expect(SupatermWorkingDirectory.normalizedPath("/tmp/./example/../other/") == "/tmp/./example/../other")
    #expect(SupatermWorkingDirectory.normalizedPath("/") == "/")
  }

  @Test
  func normalizesDecodedURLPaths() throws {
    let url = try #require(URL(string: "file:///tmp/example%20directory///"))

    #expect(SupatermWorkingDirectory.normalizedPath(url) == "/tmp/example directory")
  }

  @Test
  func validatesExistingDirectoriesAfterNormalization() throws {
    let rootURL = FileManager.default.temporaryDirectory
      .appendingPathComponent(UUID().uuidString, isDirectory: true)
    let directoryURL = rootURL.appendingPathComponent("directory", isDirectory: true)
    let fileURL = rootURL.appendingPathComponent("file", isDirectory: false)
    let linkedDirectoryURL = rootURL.appendingPathComponent("linked-directory")
    try FileManager.default.createDirectory(at: directoryURL, withIntermediateDirectories: true)
    try Data().write(to: fileURL)
    try FileManager.default.createSymbolicLink(
      at: linkedDirectoryURL,
      withDestinationURL: directoryURL
    )
    defer { try? FileManager.default.removeItem(at: rootURL) }
    let validatedLink = try #require(
      SupatermWorkingDirectory.existingDirectoryURL(for: linkedDirectoryURL.path)
    )

    #expect(
      SupatermWorkingDirectory.existingDirectoryURL(for: directoryURL.path + "///")
        == directoryURL
    )
    #expect(SupatermWorkingDirectory.existingDirectoryURL(for: fileURL.path) == nil)
    #expect(
      SupatermWorkingDirectory.normalizedPath(validatedLink) == linkedDirectoryURL.path
    )
    #expect(
      SupatermWorkingDirectory.existingDirectoryURL(
        for: rootURL.appendingPathComponent("missing").path
      ) == nil
    )
  }
}
