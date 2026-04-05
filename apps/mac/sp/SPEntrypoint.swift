import ArgumentParser
import Darwin
import Foundation
import SupatermCLIShared

public enum SPEntrypoint {
  public static func main(
    arguments: [String] = CommandLine.arguments,
    environment: [String: String] = ProcessInfo.processInfo.environment
  ) {
    do {
      if let redirectedCLIPath = redirectedCLIPath(
        environment: environment,
        currentExecutablePath: currentExecutablePath()
      ) {
        try exec(path: redirectedCLIPath, arguments: [redirectedCLIPath] + arguments.dropFirst())
      }
      if try handleRawInvocation(arguments: arguments, environment: environment) {
        return
      }
      SP.main()
    } catch {
      FileHandle.standardError.write(Data((error.localizedDescription + "\n").utf8))
      Darwin.exit(EXIT_FAILURE)
    }
  }

  static func redirectedCLIPath(
    environment: [String: String],
    currentExecutablePath: String?,
    isExecutableFile: (String) -> Bool = FileManager.default.isExecutableFile(atPath:)
  ) -> String? {
    guard
      let candidatePath = environment[SupatermCLIEnvironment.cliPathKey]?
        .trimmingCharacters(in: .whitespacesAndNewlines),
      !candidatePath.isEmpty
    else {
      return nil
    }

    let normalizedCandidatePath = normalizedExecutablePath(candidatePath)
    guard isExecutableFile(normalizedCandidatePath) else {
      return nil
    }

    guard let currentExecutablePath else {
      return nil
    }

    let normalizedCurrentExecutablePath = normalizedExecutablePath(currentExecutablePath)
    guard normalizedCandidatePath != normalizedCurrentExecutablePath else {
      return nil
    }

    return normalizedCandidatePath
  }

  static func handleRawInvocation(
    arguments: [String],
    environment: [String: String]
  ) throws -> Bool {
    let commandArguments = Array(arguments.dropFirst())
    guard let subcommand = commandArguments.first?.lowercased() else {
      return false
    }

    switch subcommand {
    case "tmux":
      let invocation = try SPRawConnectionInvocation.parse(Array(commandArguments.dropFirst()))
      if invocation.arguments.isEmpty || invocation.arguments.first == "--help" || invocation.arguments.first == "-h" {
        print(SP.helpMessage(for: SP.Tmux.self))
      } else {
        try SPTmuxCompatibility.run(
          arguments: invocation.arguments,
          explicitSocketPath: invocation.connection.explicitSocketPath,
          instance: invocation.connection.instance,
          environment: environment
        )
      }
      return true

    default:
      return false
    }
  }

  static func normalizedExecutablePath(_ path: String) -> String {
    URL(fileURLWithPath: path, isDirectory: false)
      .standardizedFileURL
      .resolvingSymlinksInPath()
      .path
  }

  static func currentExecutablePath() -> String? {
    var size: UInt32 = 0
    _ = _NSGetExecutablePath(nil, &size)

    let buffer = UnsafeMutablePointer<CChar>.allocate(capacity: Int(size))
    defer {
      buffer.deallocate()
    }

    guard _NSGetExecutablePath(buffer, &size) == 0 else {
      return nil
    }

    return String(cString: buffer)
  }

  static func exec(
    path: String,
    arguments: [String]
  ) throws -> Never {
    let argv = makeCStringArray(arguments)
    defer {
      freeCStringArray(argv)
    }

    execv(path, argv)
    let message = String(cString: strerror(errno))
    throw ValidationError("Failed to launch Supaterm CLI: \(message)")
  }
}

private func makeCStringArray(_ values: [String]) -> UnsafeMutablePointer<UnsafeMutablePointer<CChar>?> {
  let pointer = UnsafeMutablePointer<UnsafeMutablePointer<CChar>?>.allocate(capacity: values.count + 1)
  for (index, value) in values.enumerated() {
    pointer[index] = strdup(value)
  }
  pointer[values.count] = nil
  return pointer
}

private func freeCStringArray(_ pointer: UnsafeMutablePointer<UnsafeMutablePointer<CChar>?>) {
  var index = 0
  while let value = pointer[index] {
    free(value)
    index += 1
  }
  pointer.deallocate()
}
