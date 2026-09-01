import ArgumentParser
import Foundation
import SupatermCLIShared

struct SPGroupIconResult: Encodable, Equatable {
  let path: String?

  private enum CodingKeys: String, CodingKey {
    case path
  }

  func encode(to encoder: Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    if let path {
      try container.encode(path, forKey: .path)
    } else {
      try container.encodeNil(forKey: .path)
    }
  }
}

extension SP {
  struct GroupIcon: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "icon",
      abstract: "Find the first group icon.",
      discussion: SPHelp.groupIconDiscussion
    )

    @Argument(help: "Directory to inspect. Defaults to the current directory.")
    var path: String?

    @OptionGroup
    var output: SPOutputOptions

    mutating func run() throws {
      applyOutputStyle(output)
      let directoryURL = try resolvedDirectoryURL(path)
      let result = SPGroupIconResult(
        path: SupatermGroupIconResolver.resolve(in: directoryURL)?.path
      )
      if result.path == nil, output.mode == .plain {
        return
      }
      try emitCommandResult(
        result,
        options: output,
        plain: result.path ?? "",
        human: result.path ?? "No group icon found."
      )
    }

    private func resolvedDirectoryURL(_ path: String?) throws -> URL {
      let rawPath = path ?? FileManager.default.currentDirectoryPath
      let trimmedPath = rawPath.trimmingCharacters(in: .whitespacesAndNewlines)
      guard !trimmedPath.isEmpty else {
        throw ValidationError("Directory must not be empty.")
      }

      let expandedPath = expandCLIHomePath(trimmedPath)
      let directoryURL =
        NSString(string: expandedPath).isAbsolutePath
        ? URL(fileURLWithPath: expandedPath, isDirectory: true)
        : URL(fileURLWithPath: FileManager.default.currentDirectoryPath, isDirectory: true)
          .appendingPathComponent(expandedPath, isDirectory: true)
      let resolvedURL = directoryURL.standardizedFileURL.resolvingSymlinksInPath()
      var isDirectory = ObjCBool(false)
      guard
        FileManager.default.fileExists(atPath: resolvedURL.path, isDirectory: &isDirectory),
        isDirectory.boolValue
      else {
        throw ValidationError("Directory does not exist: \(resolvedURL.path)")
      }
      return resolvedURL
    }
  }
}
