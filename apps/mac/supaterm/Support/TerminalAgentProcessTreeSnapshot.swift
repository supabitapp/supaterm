public struct TerminalAgentProcessTreeSnapshot: Sendable {
  private let entriesByProcessID: [Int32: ProcessEntry]
  private let childrenByParentProcessID: [Int32: [ProcessEntry]]

  init(entries: [ProcessEntry]) {
    entriesByProcessID = entries.reduce(into: [:]) { entriesByProcessID, entry in
      entriesByProcessID[entry.processID] = entry
    }
    childrenByParentProcessID = Dictionary(
      grouping: entriesByProcessID.values,
      by: \.parentProcessID
    )
  }

  public static func capture() -> Self {
    Self(entries: ProcessTable.snapshot().entries)
  }

  public func identities(inProcessGroup processGroupID: Int32) -> Set<TerminalAgentProcessIdentity> {
    guard processGroupID > 0 else { return [] }
    return Set(
      entriesByProcessID.values.lazy
        .filter { $0.processGroupID == processGroupID }
        .map(\.identity)
    )
  }

  public func descendants(
    of roots: Set<TerminalAgentProcessIdentity>
  ) -> Set<TerminalAgentProcessIdentity> {
    var identities = Set<TerminalAgentProcessIdentity>()
    var queue: [Int32] = []
    for root in roots {
      guard entriesByProcessID[root.processID]?.identity == root else { continue }
      identities.insert(root)
      queue.append(root.processID)
    }

    var index = 0
    while index < queue.count {
      let processID = queue[index]
      index += 1
      for child in childrenByParentProcessID[processID] ?? []
      where identities.insert(child.identity).inserted {
        queue.append(child.processID)
      }
    }
    return identities
  }
}
