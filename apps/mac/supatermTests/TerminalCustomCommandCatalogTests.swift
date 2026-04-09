import Foundation
import Testing

@testable import SupatermCLIShared
@testable import supaterm

struct TerminalCustomCommandCatalogTests {
  @Test
  func loadMergesNearestLocalOverGlobalAndResolvesRelativePaths() throws {
    let root = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }

    let home = try createHomeDirectory(in: root)
    let globalDirectory = try createGlobalConfigDirectory(in: home)
    let project = root.appendingPathComponent("project", isDirectory: true)
    let nested = try createNestedProjectDirectory(in: project)

    try writeCustomCommandsFile(
      globalCommandsFile(),
      to: globalDirectory.appendingPathComponent("supaterm.json", isDirectory: false)
    )

    try writeCustomCommandsFile(
      localCommandsFile(),
      to: project.appendingPathComponent("supaterm.json", isDirectory: false)
    )

    let result = TerminalCustomCommandCatalog.load(
      focusedWorkingDirectory: nested.path(percentEncoded: false),
      homeDirectoryPath: home.path(percentEncoded: false)
    )

    #expect(result.problems.isEmpty)
    #expect(result.commands.map(\.id) == ["pwd-here", "global-only", "dev-workspace"])
    #expect(result.commands.first?.title == "Local PWD")

    guard case .workspace(let workspace) = result.commands.last?.kind else {
      Issue.record("Expected workspace command")
      return
    }
    #expect(workspace.restartBehavior == .recreate)
    #expect(workspace.spaceName == "Dev Workspace")
    #expect(workspace.selectedTabIndex == 0)
    #expect(workspace.tabs[0].focusedLeafIndex == 0)

    guard case .split(let split) = workspace.tabs[0].rootPane else {
      Issue.record("Expected split pane")
      return
    }
    guard case .leaf(let server) = split.first else {
      Issue.record("Expected server leaf")
      return
    }
    guard case .leaf(let logs) = split.second else {
      Issue.record("Expected logs leaf")
      return
    }

    let normalizedProjectPath = GhosttySurfaceView.normalizedWorkingDirectoryPath(
      project.path(percentEncoded: false)
    )
    #expect(server.workingDirectoryPath == normalizedProjectPath)
    #expect(server.environmentVariables == [.init(key: "APP_ENV", value: "dev")])
    #expect(logs.workingDirectoryPath == normalizedProjectPath)
  }

  @Test
  func loadReportsDuplicateIDsAndReservedEnvironmentKeys() throws {
    let root = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }

    let home = root.appendingPathComponent("home", isDirectory: true)
    let configDirectory =
      home
      .appendingPathComponent(".config", isDirectory: true)
      .appendingPathComponent("supaterm", isDirectory: true)
    try FileManager.default.createDirectory(at: configDirectory, withIntermediateDirectories: true)

    let project = root.appendingPathComponent("project", isDirectory: true)
    try FileManager.default.createDirectory(at: project, withIntermediateDirectories: true)

    try writeCustomCommandsFile(
      invalidCommandsFile(),
      to: project.appendingPathComponent("supaterm.json", isDirectory: false)
    )

    let result = TerminalCustomCommandCatalog.load(
      focusedWorkingDirectory: project.path(percentEncoded: false),
      homeDirectoryPath: home.path(percentEncoded: false)
    )

    #expect(result.commands.map(\.id) == ["dup"])
    #expect(result.problems.count == 2)
    #expect(result.problems.contains { $0.message.contains("Duplicate command ids") })
    #expect(result.problems.contains { $0.message.contains("reserved environment key PATH") })
  }
}

private func writeCustomCommandsFile(
  _ file: SupatermCustomCommandsFile,
  to url: URL
) throws {
  let encoder = JSONEncoder()
  encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
  try encoder.encode(file).write(to: url)
}

private func temporaryDirectory() throws -> URL {
  let url = FileManager.default.temporaryDirectory
    .appendingPathComponent(UUID().uuidString, isDirectory: true)
  try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
  return url
}

private func createHomeDirectory(in root: URL) throws -> URL {
  let url = root.appendingPathComponent("home", isDirectory: true)
  try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
  return url
}

private func createGlobalConfigDirectory(in home: URL) throws -> URL {
  let url =
    home
    .appendingPathComponent(".config", isDirectory: true)
    .appendingPathComponent("supaterm", isDirectory: true)
  try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
  return url
}

private func createNestedProjectDirectory(in project: URL) throws -> URL {
  let url =
    project
    .appendingPathComponent("src", isDirectory: true)
    .appendingPathComponent("feature", isDirectory: true)
  try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
  return url
}

private func globalCommandsFile() -> SupatermCustomCommandsFile {
  .init(
    commands: [
      .init(
        id: "pwd-here",
        kind: .command,
        name: "Global PWD",
        description: "Global",
        keywords: ["global"],
        command: "pwd"
      ),
      .init(
        id: "global-only",
        kind: .command,
        name: "Global Only",
        command: "echo global"
      ),
    ]
  )
}

private func localCommandsFile() -> SupatermCustomCommandsFile {
  .init(
    commands: [
      .init(
        id: "pwd-here",
        kind: .command,
        name: "Local PWD",
        description: "Local",
        keywords: ["local"],
        command: "pwd && echo local"
      ),
      .init(
        id: "dev-workspace",
        kind: .workspace,
        name: "Dev Workspace",
        restartBehavior: .recreate,
        workspace: .init(
          spaceName: "Dev Workspace",
          tabs: [
            .init(
              title: "App",
              cwd: ".",
              selected: true,
              rootPane: .split(
                .init(
                  direction: .right,
                  ratio: 0.5,
                  first: .leaf(
                    .init(
                      title: "Server",
                      cwd: ".",
                      command: "pwd",
                      focus: true,
                      env: .init(["APP_ENV": "dev"])
                    )
                  ),
                  second: .leaf(
                    .init(
                      title: "Logs",
                      command: "tail -f log.txt"
                    )
                  )
                )
              ),
            ),
          ],
        )
      ),
    ]
  )
}

private func invalidCommandsFile() -> SupatermCustomCommandsFile {
  .init(
    commands: [
      .init(
        id: "dup",
        kind: .command,
        name: "One",
        command: "echo one"
      ),
      .init(
        id: "dup",
        kind: .command,
        name: "Two",
        command: "echo two"
      ),
      .init(
        id: "bad-env",
        kind: .workspace,
        name: "Bad Env",
        workspace: .init(
          spaceName: "Bad Env",
          tabs: [
            .init(
              title: "App",
              rootPane: .leaf(
                .init(
                  command: "pwd",
                  env: .init(["PATH": "/tmp/bin"])
                )
              ),
            ),
          ],
        )
      ),
    ]
  )
}
