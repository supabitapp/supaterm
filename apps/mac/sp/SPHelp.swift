import ArgumentParser
import SupatermCLIShared

enum SPHelp {
  static let socketDefaultValueDescription = "$\(SupatermCLIEnvironment.socketPathKey)"

  static let rootDiscussion = """
    Environment:
      \(SupatermCLIEnvironment.socketPathKey)  Auto-set in Supaterm panes. Default --socket.
      \(SupatermCLIEnvironment.surfaceIDKey)  Auto-set in Supaterm panes. Current pane ID.
      \(SupatermCLIEnvironment.tabIDKey)  Auto-set in Supaterm panes. Current tab ID.

    Example:
      sp tree
      sp new-tab --space 1 --focus
      sp new-pane --space 1 --tab 1 down
      sp debug
      sp instances
    """

  static let treeDiscussion = """
    Example:
      sp tree
      sp tree --json
      sp tree --instance work-mac
    """

  static let onboardDiscussion = """
    Example:
      sp onboard
      sp onboard --instance work-mac
    """

  static let debugDiscussion = """
    Example:
      sp debug
      sp debug --json
      sp debug --instance work-mac
    """

  static let instancesDiscussion = """
    Example:
      sp instances
      sp instances --json
    """

  static let newPaneDiscussion = """
    If you omit --space and --tab inside Supaterm, this command splits the current pane.

    That ambient pane target comes from \(SupatermCLIEnvironment.surfaceIDKey) and \(SupatermCLIEnvironment.tabIDKey).

    Example:
      sp new-pane right
      sp new-pane down htop
      sp new-pane --space 1 --tab 2 left
      sp new-pane --space 1 --tab 2 --pane 3 down tail -f /tmp/server.log
    """

  static let newTabDiscussion = """
    If you omit --space inside Supaterm, this command creates the tab in the current space.

    That ambient pane target comes from \(SupatermCLIEnvironment.surfaceIDKey) and \(SupatermCLIEnvironment.tabIDKey).

    Example:
      sp new-tab ping 1.1.1.1
      sp new-tab --focus ping 1.1.1.1
      sp new-tab --space 1 --cwd ~/tmp ping 1.1.1.1
    """

  static let notifyDiscussion = """
    Example:
      sp notify --body "All tests passed"
      sp notify --space 1 --tab 2 --pane 3 --body "Deploy complete"
    """
}

enum SPSocketOption: ExpressibleByArgument {
  case environment
  case explicit(String)

  init?(argument: String) {
    self = .explicit(argument)
  }

  var defaultValueDescription: String {
    switch self {
    case .environment:
      return SPHelp.socketDefaultValueDescription
    case .explicit(let path):
      return path
    }
  }

  var explicitPath: String? {
    switch self {
    case .environment:
      return nil
    case .explicit(let path):
      return path
    }
  }
}

struct SPConnectionOptions: ParsableArguments {
  @Option(
    name: .long,
    help: ArgumentHelp("Override the Unix socket path.", valueName: "socket")
  )
  var socket: SPSocketOption = .environment

  @Option(name: .long, help: "Target a reachable Supaterm instance by name or endpoint ID.")
  var instance: String?

  var explicitSocketPath: String? {
    socket.explicitPath
  }
}
