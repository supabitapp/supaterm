import ArgumentParser

extension SP {
  struct KillSession: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "__kill-session",
      abstract: "Kill a managed Supaterm session.",
      shouldDisplay: false
    )

    @Option(name: .long, help: "Managed Supaterm pane session name.")
    var session: String

    mutating func run() throws {
      try SPZMXCore.killSession(named: session)
    }
  }
}
