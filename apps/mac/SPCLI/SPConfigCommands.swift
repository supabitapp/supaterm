import ArgumentParser
import Foundation
import SupatermCLIShared

extension SP {
  struct Config: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "config",
      abstract: "Inspect and validate Supaterm configuration.",
      discussion: SPHelp.configDiscussion,
      subcommands: [ValidateConfig.self]
    )

    mutating func run() throws {
      print(Self.helpMessage())
    }
  }

  struct ValidateConfig: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "validate",
      abstract: "Validate Supaterm configuration.",
      discussion: SPHelp.validateConfigDiscussion
    )

    @Option(name: .long, help: "Validate a specific config file instead of the default path.")
    var path: String?

    @OptionGroup
    var output: SPOutputOptions

    mutating func run() throws {
      applyOutputStyle(output)
      let validator = SupatermSettingsValidator()
      let explicitPath = try resolvedConfigPath(path)
      let result = validator.validate(path: explicitPath)

      guard !output.quiet else {
        if shouldFail(result: result, explicitPath: explicitPath) {
          throw ExitCode.failure
        }
        return
      }

      switch output.mode {
      case .json:
        print(try jsonString(result))
      case .plain:
        print(renderPlain(result))
      case .human:
        print(renderHuman(result))
      }

      if shouldFail(result: result, explicitPath: explicitPath) {
        throw ExitCode.failure
      }
    }
  }
}

private func shouldFail(
  result: SupatermSettingsValidationResult,
  explicitPath: URL?
) -> Bool {
  if explicitPath != nil, result.status == .missing {
    return true
  }
  return result.isFailure
}

private func resolvedConfigPath(_ path: String?) throws -> URL? {
  guard let path else { return nil }
  let trimmed = path.trimmingCharacters(in: .whitespacesAndNewlines)
  guard !trimmed.isEmpty else {
    throw ValidationError("--path must not be empty.")
  }
  let expandedPath = NSString(string: trimmed).expandingTildeInPath
  let url: URL
  if expandedPath.hasPrefix("/") {
    url = URL(fileURLWithPath: expandedPath, isDirectory: false)
  } else {
    url = URL(fileURLWithPath: FileManager.default.currentDirectoryPath, isDirectory: true)
      .appendingPathComponent(expandedPath, isDirectory: false)
  }
  return url.standardizedFileURL
}

private func renderPlain(_ result: SupatermSettingsValidationResult) -> String {
  let lines =
    [
      "\(result.status.rawValue)\t\(result.path)"
    ] + result.warnings.map { "warning\t\($0)" } + result.errors.map { "error\t\($0)" }
  return lines.joined(separator: "\n")
}

private func renderHuman(_ result: SupatermSettingsValidationResult) -> String {
  let headline: String
  switch result.status {
  case .valid:
    headline = "Valid config: \(result.path)"
  case .missing:
    headline =
      result.errors.isEmpty
      ? "No config file at \(result.path). Defaults are in effect."
      : "Missing config: \(result.path)"
  case .invalid:
    headline = "Invalid config: \(result.path)"
  }

  let warningLines = result.warnings.map { "warning: \($0)" }
  let errorLines = result.errors.map { "error: \($0)" }
  return ([headline] + warningLines + errorLines).joined(separator: "\n")
}
