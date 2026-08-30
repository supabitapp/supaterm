public struct TerminalAgentProcessTreeSnapshot: Sendable {
  private let entriesByProcessID: [Int32: ProcessEntry]

  init(entries: [ProcessEntry]) {
    entriesByProcessID = entries.reduce(into: [:]) { entriesByProcessID, entry in
      entriesByProcessID[entry.processID] = entry
    }
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

    let childrenByParentProcessID = Dictionary(
      grouping: entriesByProcessID.values,
      by: \.parentProcessID
    )
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

  public func isRelated(
    processID: Int32?,
    candidate: TerminalAgentProcessIdentity
  ) -> Bool? {
    guard let processID,
      let candidateEntry = entriesByProcessID[candidate.processID],
      candidateEntry.identity == candidate
    else {
      return nil
    }
    guard processID != candidate.processID else { return true }
    guard let processEntry = entriesByProcessID[processID] else { return nil }
    if processEntry.processGroupID > 0,
      processEntry.processGroupID == candidateEntry.processGroupID
    {
      return true
    }
    if containsAncestor(candidate.processID, of: processID)
      || containsAncestor(processID, of: candidate.processID)
    {
      return true
    }
    return false
  }

  public func isRelated(
    processID: Int32?,
    foregroundProcessGroupID: Int32?
  ) -> Bool? {
    guard let processID,
      let foregroundProcessGroupID,
      foregroundProcessGroupID > 0,
      let processEntry = entriesByProcessID[processID]
    else {
      return nil
    }
    if processEntry.processGroupID == foregroundProcessGroupID {
      return true
    }
    let foregroundEntries = entriesByProcessID.values.filter {
      $0.processGroupID == foregroundProcessGroupID
    }
    guard !foregroundEntries.isEmpty else { return nil }
    if foregroundEntries.contains(where: {
      containsAncestor($0.processID, of: processID)
        || containsAncestor(processID, of: $0.processID)
    }) {
      return true
    }
    return false
  }

  public func identity(for processID: Int32?) -> TerminalAgentProcessIdentity? {
    processID.flatMap { entriesByProcessID[$0]?.identity }
  }

  public func identity(foregroundProcessGroupID: Int32?) -> TerminalAgentProcessIdentity? {
    guard let foregroundProcessGroupID, foregroundProcessGroupID > 0 else { return nil }
    return entriesByProcessID[foregroundProcessGroupID]?.identity
      ?? entriesByProcessID.values.first {
        $0.processGroupID == foregroundProcessGroupID
      }?.identity
  }

  private func containsAncestor(_ ancestorProcessID: Int32, of processID: Int32) -> Bool {
    var processID = processID
    var visited: Set<Int32> = []
    while visited.insert(processID).inserted,
      let entry = entriesByProcessID[processID],
      entry.parentProcessID > 0
    {
      if entry.parentProcessID == ancestorProcessID { return true }
      processID = entry.parentProcessID
    }
    return false
  }
}
