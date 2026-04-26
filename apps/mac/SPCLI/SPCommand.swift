import ArgumentParser

public struct SP: ParsableCommand {
  public static let configuration = CommandConfiguration(
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
    ComputerUse.self,
    Agent.self,
    Tmux.self,
    Internal.self,
  ]

  public init() {}

  public mutating func run() throws {
    print(Self.helpMessage())
  }
}
