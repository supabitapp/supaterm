import Foundation
import SupatermSupport

nonisolated enum ProjectKind: String, CaseIterable, Hashable, Sendable {
  case swift
  case node
  case rust
  case go
  case python
  case ruby
  case zig
}

nonisolated struct DirectoryFingerprint: Equatable, Sendable {
  let fileNames: Set<String>
  let folderNames: Set<String>
  let extensions: Set<String>

  init(
    fileNames: Set<String> = [],
    folderNames: Set<String> = [],
    extensions: Set<String> = []
  ) {
    self.fileNames = fileNames
    self.folderNames = folderNames
    self.extensions = extensions
  }

  init?(directory: URL, fileManager: FileManager = .default) {
    guard
      let entries = try? fileManager.contentsOfDirectory(
        at: directory,
        includingPropertiesForKeys: [.isDirectoryKey]
      )
    else {
      return nil
    }

    var fileNames: Set<String> = []
    var folderNames: Set<String> = []
    var extensions: Set<String> = []
    for entry in entries {
      let name = entry.lastPathComponent
      if (try? entry.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true {
        folderNames.insert(name)
      } else {
        fileNames.insert(name)
        let pathExtension = entry.pathExtension.lowercased()
        if !pathExtension.isEmpty {
          extensions.insert(pathExtension)
        }
      }
    }

    self.init(fileNames: fileNames, folderNames: folderNames, extensions: extensions)
  }

  var containsRepositoryRoot: Bool {
    fileNames.contains(".git") || folderNames.contains(".git")
  }
}

nonisolated struct ProjectKindRule: Equatable, Sendable {
  let kind: ProjectKind
  let files: [String]
  let extensions: [String]
  let folders: [String]

  func matches(_ fingerprint: DirectoryFingerprint) -> Bool {
    var hasIncludedFile = false
    for file in files {
      if file.hasPrefix("!") {
        if fingerprint.fileNames.contains(String(file.dropFirst())) {
          return false
        }
      } else if fingerprint.fileNames.contains(file) {
        hasIncludedFile = true
      }
    }

    return hasIncludedFile || extensions.contains(where: fingerprint.extensions.contains)
      || folders.contains(where: fingerprint.folderNames.contains)
  }
}

nonisolated enum ProjectKindDetector {
  static let rules = [
    ProjectKindRule(
      kind: .swift,
      files: ["Package.swift", "Project.swift"],
      extensions: ["swift"],
      folders: [".swiftpm"]
    ),
    ProjectKindRule(
      kind: .node,
      files: [
        "package.json", ".nvmrc", "bunfig.toml", "bun.lock", "bun.lockb", "deno.json",
        "deno.jsonc",
      ],
      extensions: ["js", "jsx", "mjs", "cjs", "ts", "tsx"],
      folders: ["node_modules"]
    ),
    ProjectKindRule(
      kind: .rust,
      files: ["Cargo.toml"],
      extensions: ["rs"],
      folders: []
    ),
    ProjectKindRule(
      kind: .go,
      files: ["go.mod", "go.work"],
      extensions: ["go"],
      folders: []
    ),
    ProjectKindRule(
      kind: .python,
      files: [
        "pyproject.toml", "requirements.txt", "setup.py", "tox.ini", ".python-version", "Pipfile",
      ],
      extensions: ["py"],
      folders: [".venv"]
    ),
    ProjectKindRule(
      kind: .ruby,
      files: ["Gemfile", ".ruby-version", "Rakefile"],
      extensions: ["rb"],
      folders: [".bundle"]
    ),
    ProjectKindRule(
      kind: .zig,
      files: ["build.zig", "build.zig.zon"],
      extensions: ["zig", "zon"],
      folders: []
    ),
  ]

  static func detect(
    workingDirectoryPath: String,
    fingerprint: (URL) -> DirectoryFingerprint? = { DirectoryFingerprint(directory: $0) }
  ) -> ProjectKind? {
    var directory = URL(fileURLWithPath: workingDirectoryPath, isDirectory: true)
      .standardizedFileURL
      .resolvingSymlinksInPath()

    while true {
      guard let fingerprint = fingerprint(directory) else { return nil }
      if let kind = rules.first(where: { $0.matches(fingerprint) })?.kind {
        return kind
      }
      if fingerprint.containsRepositoryRoot {
        return nil
      }
      let parent = directory.deletingLastPathComponent()
      guard parent != directory else { return nil }
      directory = parent
    }
  }
}

nonisolated enum CommandGlyph: String, Hashable, Sendable {
  case claude
  case codex
  case pi
  case sourceControl
  case remote
  case editor
  case build
  case package
  case code
  case ruby
  case container
  case search
  case rust
}

nonisolated struct TerminalFaviconContext: Equatable, Sendable {
  let foregroundCommand: String?
  let projectKind: ProjectKind?
}

nonisolated enum TerminalFavicon: Hashable, Sendable {
  case command(CommandGlyph)
  case project(ProjectKind)
  case shell

  var measurementKey: String {
    switch self {
    case .command(let command):
      return "command:\(command.rawValue)"
    case .project(let project):
      return "project:\(project.rawValue)"
    case .shell:
      return "shell"
    }
  }
}

nonisolated enum TerminalFaviconResolver {
  static let commandGlyphs: [String: CommandGlyph] = [
    "claude": .claude,
    "codex": .codex,
    "pi": .pi,
    "git": .sourceControl,
    "gh": .sourceControl,
    "ssh": .remote,
    "mosh": .remote,
    "vim": .editor,
    "nvim": .editor,
    "nano": .editor,
    "make": .build,
    "cmake": .build,
    "ninja": .build,
    "xcodebuild": .build,
    "swift": .code,
    "cargo": .rust,
    "rustc": .rust,
    "go": .code,
    "python": .code,
    "python3": .code,
    "ruby": .ruby,
    "node": .package,
    "npm": .package,
    "pnpm": .package,
    "yarn": .package,
    "bun": .package,
    "deno": .package,
    "docker": .container,
    "kubectl": .container,
    "rg": .search,
  ]

  static func commandGlyph(for command: String?) -> CommandGlyph? {
    guard let command else { return nil }
    return commandGlyphs[URL(fileURLWithPath: command).lastPathComponent.lowercased()]
  }
}

nonisolated func resolveFavicon(_ context: TerminalFaviconContext) -> TerminalFavicon {
  if let command = TerminalFaviconResolver.commandGlyph(for: context.foregroundCommand) {
    return .command(command)
  }
  if let projectKind = context.projectKind {
    return .project(projectKind)
  }
  return .shell
}

nonisolated enum TerminalFaviconLoader {
  static func resolve(
    surfaceID: UUID,
    foregroundProcessGroupID: Int32?,
    usesZmx: Bool,
    workingDirectoryPath: String?
  ) async -> TerminalFavicon {
    let command = await Task.detached(priority: .utility) {
      TerminalForegroundProcess.commandName(
        processGroupID: foregroundProcessGroupID,
        zmxSessionName: usesZmx ? ZmxSessionID.make(surfaceID: surfaceID) : nil
      )
    }.value
    let commandFavicon = resolveFavicon(
      TerminalFaviconContext(foregroundCommand: command, projectKind: nil)
    )
    if case .command = commandFavicon {
      return commandFavicon
    }
    let projectKind = await Task.detached(priority: .utility) {
      workingDirectoryPath.flatMap {
        ProjectKindDetector.detect(workingDirectoryPath: $0)
      }
    }.value
    return resolveFavicon(
      TerminalFaviconContext(foregroundCommand: command, projectKind: projectKind)
    )
  }
}

nonisolated struct TerminalFaviconUpdateSequence {
  private(set) var current: UInt64 = 0

  mutating func begin() -> UInt64 {
    current &+= 1
    return current
  }

  func accepts(_ update: UInt64) -> Bool {
    update == current
  }
}
