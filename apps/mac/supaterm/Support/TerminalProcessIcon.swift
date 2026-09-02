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
    let processGroupIDs = foregroundProcessGroupIDs.filter { $0 > 0 }
    guard !processGroupIDs.isEmpty else { return [:] }
    return Dictionary(
      grouping: table.entries.filter { processGroupIDs.contains($0.processGroupID) },
      by: \.processGroupID
    ).compactMapValues { entries in
      match(entries: entries, invocation: invocation)
    }
  }

  private static func match(
    entries: [ProcessEntry],
    invocation: InvocationProvider
  ) -> TerminalProcessIconMatch? {
    let entriesByProcessID = Dictionary(uniqueKeysWithValues: entries.map { ($0.processID, $0) })
    let candidates = entries.compactMap { entry -> Candidate? in
      let icon =
        invocation(entry.processID).flatMap {
          TerminalProcessIcon.matching(executableName: $0.executablePath)
        } ?? TerminalProcessIcon.matching(executableName: entry.name)
      return icon.map { Candidate(icon: $0, process: entry) }
    }
    guard
      let candidate = candidates.max(by: {
        let leftDepth = depth(of: $0.process, entriesByProcessID: entriesByProcessID)
        let rightDepth = depth(of: $1.process, entriesByProcessID: entriesByProcessID)
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

  private static func depth(
    of process: ProcessEntry,
    entriesByProcessID: [pid_t: ProcessEntry]
  ) -> Int {
    var process = process
    var processIDs = Set([process.processID])
    var depth = 0
    while let parent = entriesByProcessID[process.parentProcessID] {
      guard processIDs.insert(parent.processID).inserted else { return Int.max }
      process = parent
      depth += 1
    }
    return depth
  }

  private struct Candidate {
    let icon: TerminalProcessIcon
    let process: ProcessEntry
  }
}
