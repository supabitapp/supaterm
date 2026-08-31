import Foundation
import Observation
import SupatermCLIShared

nonisolated struct TerminalTabGroupIconRequest: Hashable, Sendable {
  let workingDirectoryPaths: [String]

  init(workingDirectoryPaths: [String]) {
    var seen = Set<String>()
    self.workingDirectoryPaths = workingDirectoryPaths.filter { seen.insert($0).inserted }
  }

  func resolve() -> URL? {
    for path in workingDirectoryPaths {
      guard
        let rootPath = TerminalTabGroupTitleSuggester.repositoryRoot(for: path),
        let iconURL = SupatermProjectIconResolver.resolve(
          in: URL(fileURLWithPath: rootPath, isDirectory: true)
        )
      else {
        continue
      }
      return iconURL
    }
    return nil
  }
}

@MainActor
@Observable
final class TerminalTabGroupIconStore {
  typealias Resolver = @Sendable (TerminalTabGroupIconRequest) -> URL?

  private enum Resolution: Equatable {
    case icon(URL)
    case missing
  }

  private var resolutions: [TerminalTabGroupIconRequest: Resolution] = [:]
  @ObservationIgnored private let resolver: Resolver
  @ObservationIgnored private var tasks: [TerminalTabGroupIconRequest: Task<URL?, Never>] = [:]

  init(
    resolver: @escaping Resolver = { $0.resolve() }
  ) {
    self.resolver = resolver
  }

  func iconURLs(
    for requestsByGroupID: [TerminalTabGroupID: TerminalTabGroupIconRequest]
  ) -> [TerminalTabGroupID: URL] {
    requestsByGroupID.reduce(into: [:]) { iconURLs, entry in
      guard case .icon(let iconURL) = resolutions[entry.value] else { return }
      iconURLs[entry.key] = iconURL
    }
  }

  func load(
    _ requestsByGroupID: [TerminalTabGroupID: TerminalTabGroupIconRequest]
  ) async {
    let requests = Set(requestsByGroupID.values)
    var pending: [(TerminalTabGroupIconRequest, Task<URL?, Never>)] = []
    for request in requests where resolutions[request] == nil {
      if let task = tasks[request] {
        pending.append((request, task))
      } else {
        let resolver = resolver
        let task = Task.detached(priority: .utility) {
          resolver(request)
        }
        tasks[request] = task
        pending.append((request, task))
      }
    }

    for (request, task) in pending {
      let iconURL = await task.value
      guard resolutions[request] == nil else { continue }
      tasks[request] = nil
      resolutions[request] = iconURL.map(Resolution.icon) ?? .missing
    }
  }
}

extension TerminalHostState {
  func tabGroupIconRequests(
    for snapshot: TerminalTabSurfaceSnapshot
  ) -> [TerminalTabGroupID: TerminalTabGroupIconRequest] {
    Dictionary(
      uniqueKeysWithValues: snapshot.collection.rootItems.compactMap { root in
        guard case .group(let group) = root else { return nil }
        return (
          group.id,
          TerminalTabGroupIconRequest(
            workingDirectoryPaths: group.tabs.flatMap {
              paneWorkingDirectoryPaths(for: $0.id)
            }
          )
        )
      }
    )
  }
}
