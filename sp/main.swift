import ArgumentParser
import SupatermCLIShared

struct SP: ParsableCommand {
  static let configuration = CommandConfiguration(
    commandName: "sp",
    abstract: "Supaterm pane command-line interface.",
    subcommands: [Ping.self]
  )

  mutating func run() throws {
    if SupatermCLIContext.current == nil {
      print("sp is bundled for Supaterm terminal panes. Run 'sp --help' to see available commands.")
      return
    }

    print("sp is available in this Supaterm pane. Run 'sp --help' to see available commands.")
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
      let client = try SPSocketClient(
        path: resolvedSocketPath()
      )
      let response = try client.send(.ping())
      guard response.ok else {
        throw ValidationError(response.error?.message ?? "Supaterm socket request failed.")
      }
      guard response.result?["pong"]?.boolValue == true else {
        throw ValidationError("Supaterm socket ping returned an unexpected response.")
      }
      print("pong")
    }

    private func resolvedSocketPath() throws -> String {
      guard let path = SupatermSocketPath.resolve(explicitPath: socket) else {
        throw ValidationError("Unable to resolve a Supaterm socket path.")
      }
      return path
    }
  }
}

SP.main()
