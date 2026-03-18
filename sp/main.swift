import ArgumentParser
import SupatermCLIShared

struct SP: ParsableCommand {
  static let configuration = CommandConfiguration(
    commandName: "sp",
    abstract: "Supaterm pane command-line interface."
  )

  mutating func run() throws {
    if SupatermCLIContext.current == nil {
      print("sp is bundled for Supaterm terminal panes. Commands are not implemented yet.")
      return
    }

    print("sp is available in this Supaterm pane. Commands are not implemented yet.")
  }
}

SP.main()
