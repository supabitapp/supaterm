import ArgumentParser

struct SP: ParsableCommand {
  static let configuration = CommandConfiguration(
    commandName: "sp",
    abstract: "Supaterm pane command-line interface.",
    discussion: SPHelp.rootDiscussion,
    subcommands: availableSubcommands
  )

  private static let availableSubcommands: [ParsableCommand.Type] = [
    Onboard.self,
    Tree.self,
    Diagnostic.self,
    Instance.self,
    Config.self,
    Run.self,
    Space.self,
    Tab.self,
    Pane.self,
    Skills.self,
    Agent.self,
    Tmux.self,
    Internal.self,
  ]

  init() {}

  mutating func run() throws {
    print(Self.helpMessage())
  }
}
