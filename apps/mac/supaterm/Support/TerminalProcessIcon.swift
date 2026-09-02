import Darwin
import Foundation

public enum TerminalProcessIcon: String, CaseIterable, Equatable, Hashable, Sendable {
  case bash = "utilities-terminal"
  case fish
  case neovim = "nvim"
  case vim
  case emacs
  case helix
  case micro
  case kakoune
  case btop
  case bashtop
  case htop
  case nvtop
  case git
  case github
  case gitlab
  case nnn
  case vifm
  case midnightCommander = "mc"
  case python
  case ipython
  case java
  case rust
  case helm
  case nmap
  case mpv
  case musikcube
  case gemini

  private static let iconsByExecutableName: [String: Self] = [
    "bash": .bash,
    "fish": .fish,
    "nvim": .neovim,
    "neovim": .neovim,
    "vim": .vim,
    "vi": .vim,
    "emacs": .emacs,
    "hx": .helix,
    "helix": .helix,
    "micro": .micro,
    "kak": .kakoune,
    "kakoune": .kakoune,
    "btop": .btop,
    "bashtop": .bashtop,
    "htop": .htop,
    "nvtop": .nvtop,
    "git": .git,
    "gh": .github,
    "glab": .gitlab,
    "nnn": .nnn,
    "vifm": .vifm,
    "mc": .midnightCommander,
    "ipython": .ipython,
    "ipython3": .ipython,
    "java": .java,
    "jshell": .java,
    "cargo": .rust,
    "rustc": .rust,
    "helm": .helm,
    "nmap": .nmap,
    "mpv": .mpv,
    "musikcube": .musikcube,
    "gemini": .gemini,
    "gemini-cli": .gemini,
  ]

  public var resourceName: String {
    rawValue
  }

  public static func matching(executableName: String) -> Self? {
    let name = URL(fileURLWithPath: executableName).lastPathComponent.lowercased()
    if name == "python" || name.range(of: #"^python3(?:\.\d+)?$"#, options: .regularExpression) != nil {
      return .python
    }
    return iconsByExecutableName[name]
  }
}

public struct TerminalProcessIconMatch: Equatable, Hashable, Sendable {
  public let icon: TerminalProcessIcon
  public let processIdentity: TerminalAgentProcessIdentity

  public init(icon: TerminalProcessIcon, processIdentity: TerminalAgentProcessIdentity) {
    self.icon = icon
    self.processIdentity = processIdentity
  }
}

enum TerminalProcessIconRecognizer {
  typealias InvocationProvider = @Sendable (pid_t) -> ProcessInvocation?

  static func matches(
    foregroundProcessGroupIDs: Set<pid_t>,
    table: ProcessTable,
    invocation: InvocationProvider
  ) -> [pid_t: TerminalProcessIconMatch] {
    matches(
      processGroups: ForegroundProcessGroupSnapshot.snapshots(
        for: foregroundProcessGroupIDs,
        in: table
      ),
      invocation: invocation
    )
  }

  static func matches(
    processGroups: [pid_t: ForegroundProcessGroupSnapshot],
    invocation: InvocationProvider
  ) -> [pid_t: TerminalProcessIconMatch] {
    processGroups.compactMapValues { processGroup in
      match(processGroup: processGroup, invocation: invocation)
    }
  }

  private static func match(
    processGroup: ForegroundProcessGroupSnapshot,
    invocation: InvocationProvider
  ) -> TerminalProcessIconMatch? {
    let candidates = processGroup.entries.compactMap { entry -> Candidate? in
      let icon =
        invocation(entry.processID).flatMap {
          TerminalProcessIcon.matching(executableName: $0.executablePath)
        } ?? TerminalProcessIcon.matching(executableName: entry.name)
      return icon.map { Candidate(icon: $0, process: entry) }
    }
    guard
      let candidate = candidates.max(by: {
        let leftDepth = processGroup.depth(of: $0.process)
        let rightDepth = processGroup.depth(of: $1.process)
        if leftDepth != rightDepth { return leftDepth < rightDepth }
        return $0.process.processID > $1.process.processID
      })
    else {
      return nil
    }
    return TerminalProcessIconMatch(
      icon: candidate.icon,
      processIdentity: candidate.process.identity
    )
  }

  private struct Candidate {
    let icon: TerminalProcessIcon
    let process: ProcessEntry
  }
}
