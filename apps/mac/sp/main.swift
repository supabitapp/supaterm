import ArgumentParser
import Darwin
import Foundation
import SupatermCLIShared

struct SP: ParsableCommand {
  static let configuration = CommandConfiguration(
    commandName: "sp",
    abstract: "Supaterm pane command-line interface.",
    subcommands: [Ping.self, Tree.self, Onboard.self, Debug.self, NewPane.self]
  )

  mutating func run() throws {
    print(Self.helpMessage())
  }
}

extension SP {
  struct Ping: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "ping",
      abstract: "Ping the running Supaterm socket server."
    )

    @Option(name: .long, help: "Override the Unix socket path.")
    var socket: String?

    mutating func run() throws {
      let client = try socketClient(path: socket)
      let response = try client.send(.ping())
      guard response.ok else {
        throw ValidationError(response.error?.message ?? "Supaterm socket request failed.")
      }
      guard response.result?["pong"]?.boolValue == true else {
        throw ValidationError("Supaterm socket ping returned an unexpected response.")
      }
      print("pong")
    }
  }

  struct Tree: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "tree",
      abstract: "Show the current Supaterm window, space, tab, and pane tree."
    )

    @Flag(name: .long, help: "Print the tree as JSON.")
    var json = false

    @Option(name: .long, help: "Override the Unix socket path.")
    var socket: String?

    mutating func run() throws {
      let client = try socketClient(path: socket)
      let response = try client.send(.tree())
      guard response.ok else {
        throw ValidationError(response.error?.message ?? "Supaterm socket request failed.")
      }

      let snapshot = try response.decodeResult(SupatermTreeSnapshot.self)
      if json {
        print(try jsonString(snapshot))
      } else {
        print(SPTreeRenderer.render(snapshot))
      }
    }
  }

  struct Onboard: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "onboard",
      abstract: "Show Supaterm's core onboarding shortcuts."
    )

    @Option(name: .long, help: "Override the Unix socket path.")
    var socket: String?

    mutating func run() throws {
      let client = try socketClient(path: socket)
      let response = try client.send(.onboarding())
      guard response.ok else {
        throw ValidationError(response.error?.message ?? "Supaterm socket request failed.")
      }

      let snapshot = try response.decodeResult(SupatermOnboardingSnapshot.self)
      print(SPOnboardingRenderer.render(snapshot))
    }
  }

  struct Debug: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "debug",
      abstract: "Show live Supaterm diagnostics for the current application."
    )

    @Flag(name: .long, help: "Print the report as JSON.")
    var json = false

    @Option(name: .long, help: "Override the Unix socket path.")
    var socket: String?

    mutating func run() throws {
      let context = SupatermCLIContext.current
      var problems: [String] = []
      let socketPath = SupatermSocketPath.resolve(explicitPath: socket)
      var socketStatus = SPDebugReport.Socket(
        path: socketPath,
        isReachable: false,
        requestSucceeded: false,
        error: nil
      )
      var appSnapshot: SupatermAppDebugSnapshot?

      if let socketPath {
        do {
          let client = try SPSocketClient(path: socketPath)
          let response = try client.send(
            .debug(.init(context: context))
          )
          socketStatus.isReachable = true

          if response.ok {
            do {
              appSnapshot = try response.decodeResult(SupatermAppDebugSnapshot.self)
              socketStatus.requestSucceeded = true
            } catch {
              let message = error.localizedDescription
              socketStatus.error = message
              problems.append(message)
            }
          } else {
            let message = response.error?.message ?? "Supaterm socket request failed."
            socketStatus.error = message
            problems.append(message)
          }
        } catch {
          let message = error.localizedDescription
          socketStatus.error = message
          problems.append(message)
        }
      } else {
        let message = "Unable to resolve a Supaterm socket path."
        socketStatus.error = message
        problems.append(message)
      }

      let report = SPDebugReport(
        invocation: .init(
          isRunningInsideSupaterm: context != nil,
          context: context,
          resolvedSocketPath: socketPath
        ),
        socket: socketStatus,
        app: appSnapshot,
        problems: problems
      )

      if json {
        print(try jsonString(report))
      } else {
        print(SPDebugRenderer.render(report))
      }

      if !socketStatus.requestSucceeded {
        throw ExitCode.failure
      }
    }
  }

  struct NewPane: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "new-pane",
      abstract: "Create a new pane beside an existing Supaterm pane."
    )

    enum PaneDirectionArgument: String, CaseIterable, ExpressibleByArgument {
      case down
      case left
      case right
      case up

      var direction: SupatermPaneDirection {
        switch self {
        case .down:
          return .down
        case .left:
          return .left
        case .right:
          return .right
        case .up:
          return .up
        }
      }
    }

    @Argument(help: "Direction for the new pane.")
    var direction: PaneDirectionArgument = .right

    @Option(name: .long, help: "Target a pane inside the selected tab by its 1-based index.")
    var pane: Int?

    @Option(name: .long, help: "Override the Unix socket path.")
    var socket: String?

    @Option(name: .long, help: "Target a tab by its 1-based index.")
    var tab: Int?

    @Option(name: .long, help: "Target a window by its 1-based index. Defaults to 1 when a tab target is set.")
    var window: Int?

    @Flag(inversion: .prefixedNo, help: "Focus the new pane after creating it.")
    var focus = true

    @Flag(name: .long, help: "Print the result as JSON.")
    var json = false

    @Argument(help: "Optional shell command to run immediately in the new pane.")
    var command: [String] = []

    mutating func run() throws {
      try validate()

      let client = try socketClient(path: socket)
      let response = try client.send(.newPane(try requestPayload()))
      guard response.ok else {
        throw ValidationError(response.error?.message ?? "Supaterm socket request failed.")
      }

      let result = try response.decodeResult(SupatermNewPaneResult.self)
      if json {
        print(try jsonString(result))
      } else {
        print("window \(result.windowIndex) tab \(result.tabIndex) pane \(result.paneIndex)")
      }
    }

    func validate() throws {
      if let window, window < 1 {
        throw ValidationError("--window must be 1 or greater.")
      }
      if let tab, tab < 1 {
        throw ValidationError("--tab must be 1 or greater.")
      }
      if let pane, pane < 1 {
        throw ValidationError("--pane must be 1 or greater.")
      }
      if pane != nil && tab == nil {
        throw ValidationError("--pane requires --tab.")
      }
      if window != nil && tab == nil {
        throw ValidationError("--window requires --tab.")
      }
      if tab == nil && pane == nil && SupatermCLIContext.current == nil {
        throw ValidationError("Run this command inside a Supaterm pane or provide --tab.")
      }
    }

    private func requestPayload() throws -> SupatermNewPaneRequest {
      let command = shellCommandInput(command)

      if let tab {
        return SupatermNewPaneRequest(
          command: command,
          direction: direction.direction,
          focus: focus,
          targetPaneIndex: pane,
          targetTabIndex: tab,
          targetWindowIndex: window ?? 1
        )
      }

      guard let context = SupatermCLIContext.current else {
        throw ValidationError("Run this command inside a Supaterm pane or provide --tab.")
      }

      return SupatermNewPaneRequest(
        command: command,
        contextPaneID: context.surfaceID,
        direction: direction.direction,
        focus: focus
      )
    }
  }
}

private func jsonString<T: Encodable>(_ value: T) throws -> String {
  let encoder = JSONEncoder()
  encoder.outputFormatting = [.sortedKeys]
  return String(decoding: try encoder.encode(value), as: UTF8.self)
}

private func resolvedSocketPath(explicitPath: String?) throws -> String {
  guard let path = SupatermSocketPath.resolve(explicitPath: explicitPath) else {
    throw ValidationError("Unable to resolve a Supaterm socket path.")
  }
  return path
}

private func shellCommandInput(_ tokens: [String]) -> String? {
  guard !tokens.isEmpty else { return nil }
  return tokens.map(shellEscapedToken).joined(separator: " ")
}

private func shellEscapedToken(_ token: String) -> String {
  guard !token.isEmpty else { return "''" }

  let safeScalars = CharacterSet(
    charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@%_+=:,./-")
  if token.unicodeScalars.allSatisfy(safeScalars.contains) {
    return token
  }

  return "'\(token.replacingOccurrences(of: "'", with: "'\"'\"'"))'"
}

private func socketClient(path: String?) throws -> SPSocketClient {
  try SPSocketClient(path: resolvedSocketPath(explicitPath: path))
}

private enum SPTerminalStyle {
  private static let isEnabled = isatty(FileHandle.standardOutput.fileDescriptor) != 0

  static func bold(_ text: String) -> String {
    guard isEnabled else { return text }
    return "\u{001B}[1m\(text)\u{001B}[0m"
  }
}

private enum SPOnboardingRenderer {
  static func render(_ snapshot: SupatermOnboardingSnapshot) -> String {
    let shortcutWidth = snapshot.items.map(\.shortcut.count).max() ?? 0
    var lines = [SPTerminalStyle.bold("Common Shortcuts")]

    if !snapshot.items.isEmpty {
      lines.append("")
      lines.append(
        contentsOf: snapshot.items.map { item in
          "\(SPTerminalStyle.bold(item.shortcut.padding(toLength: shortcutWidth, withPad: " ", startingAt: 0)))  \(item.title)"
        }
      )
    }

    return lines.joined(separator: "\n")
  }
}

SP.main()
