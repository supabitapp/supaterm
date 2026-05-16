import Darwin
import Foundation
import SupatermCLIShared

struct TerminalAgentPresenceStore {
  struct Instance: Equatable, Sendable {
    let activity: TerminalHostState.AgentActivity
    let revision: Int
    let surfaceID: UUID
    let surfaceIndex: Int
  }

  private struct Key: Hashable, Sendable {
    let surfaceID: UUID
    let agent: SupatermAgentKind
  }

  private struct Record: Equatable, Sendable {
    var sessionIDs: Set<String> = []
    var processIDs: Set<Int32> = []
    var activity: TerminalHostState.AgentActivity?
    var revision: Int
  }

  private var records: [Key: Record] = [:]
  private var nextRevision = 0

  @discardableResult
  mutating func register(
    agent: SupatermAgentKind,
    surfaceID: UUID,
    sessionID: String?,
    processID: Int32?
  ) -> Bool {
    let key = Key(surfaceID: surfaceID, agent: agent)
    return updateRecord(for: key) { record in
      Self.insert(sessionID: sessionID, processID: processID, into: &record)
    }
  }

  @discardableResult
  mutating func setActivity(
    _ activity: TerminalHostState.AgentActivity,
    surfaceID: UUID,
    sessionID: String?,
    processID: Int32?
  ) -> Bool {
    let key = Key(surfaceID: surfaceID, agent: activity.kind)
    return updateRecord(for: key) { record in
      Self.insert(sessionID: sessionID, processID: processID, into: &record)
      record.activity = activity
    }
  }

  @discardableResult
  mutating func remove(
    agent: SupatermAgentKind,
    surfaceID: UUID,
    sessionID: String?,
    processID: Int32?
  ) -> Bool {
    let key = Key(surfaceID: surfaceID, agent: agent)
    guard var record = records[key] else { return false }
    let original = record
    if let sessionID = Self.normalizedSessionID(sessionID) {
      record.sessionIDs.remove(sessionID)
    }
    if let processID = Self.normalizedProcessID(processID) {
      record.processIDs.remove(processID)
    }
    if record.sessionIDs.isEmpty && (record.processIDs.isEmpty || processID == nil) {
      records.removeValue(forKey: key)
      return true
    }
    if record != original {
      record.revision = advanceRevision()
      records[key] = record
      return true
    }
    return false
  }

  @discardableResult
  mutating func removeSurface(_ surfaceID: UUID) -> Bool {
    let keys = records.keys.filter { $0.surfaceID == surfaceID }
    guard !keys.isEmpty else { return false }
    for key in keys {
      records.removeValue(forKey: key)
    }
    return true
  }

  @discardableResult
  mutating func pruneDeadProcesses(
    isProcessAlive: (Int32) -> Bool = TerminalAgentPresenceStore.isProcessAlive
  ) -> Set<UUID> {
    var changedSurfaceIDs: Set<UUID> = []
    for (key, record) in records where !record.processIDs.isEmpty {
      let liveProcessIDs = Set(record.processIDs.filter(isProcessAlive))
      guard liveProcessIDs != record.processIDs else { continue }
      changedSurfaceIDs.insert(key.surfaceID)
      if liveProcessIDs.isEmpty {
        records.removeValue(forKey: key)
      } else {
        var nextRecord = record
        nextRecord.processIDs = liveProcessIDs
        nextRecord.revision = advanceRevision()
        records[key] = nextRecord
      }
    }
    return changedSurfaceIDs
  }

  func badgeInstances(across surfaceIDs: [UUID]) -> [Instance] {
    let surfaceIndexes = surfaceIndexes(for: surfaceIDs)
    return records.compactMap { key, record in
      guard let surfaceIndex = surfaceIndexes[key.surfaceID] else { return nil }
      return Instance(
        activity: record.activity ?? TerminalHostState.AgentActivity(kind: key.agent, phase: .idle),
        revision: record.revision,
        surfaceID: key.surfaceID,
        surfaceIndex: surfaceIndex
      )
    }
    .sorted(by: Self.sortBadgeInstances)
  }

  func statusInstances(for surfaceID: UUID, surfaceIndex: Int) -> [Instance] {
    records.compactMap { key, record in
      guard key.surfaceID == surfaceID, let activity = record.activity else { return nil }
      return Instance(
        activity: activity,
        revision: record.revision,
        surfaceID: surfaceID,
        surfaceIndex: surfaceIndex
      )
    }
    .sorted {
      if $0.activity.kind.rawValue != $1.activity.kind.rawValue {
        return $0.activity.kind.rawValue < $1.activity.kind.rawValue
      }
      return $0.revision > $1.revision
    }
  }

  func detailActivity(for surfaceID: UUID?) -> TerminalHostState.AgentActivity? {
    guard let surfaceID else { return nil }
    return statusInstances(for: surfaceID, surfaceIndex: 0)
      .max { lhs, rhs in
        let lhsPriority = TerminalHostState.agentActivityPriority(lhs.activity.phase)
        let rhsPriority = TerminalHostState.agentActivityPriority(rhs.activity.phase)
        if lhsPriority != rhsPriority {
          return lhsPriority < rhsPriority
        }
        return lhs.revision < rhs.revision
      }?
      .activity
  }

  func processIDs(for surfaceID: UUID) -> Set<Int32> {
    records.reduce(into: Set<Int32>()) { result, entry in
      guard entry.key.surfaceID == surfaceID else { return }
      result.formUnion(entry.value.processIDs)
    }
  }

  func hasInstances(for surfaceID: UUID) -> Bool {
    records.keys.contains { $0.surfaceID == surfaceID }
  }

  private func surfaceIndexes(for surfaceIDs: [UUID]) -> [UUID: Int] {
    var surfaceIndexes: [UUID: Int] = [:]
    for (index, surfaceID) in surfaceIDs.enumerated() where surfaceIndexes[surfaceID] == nil {
      surfaceIndexes[surfaceID] = index
    }
    return surfaceIndexes
  }

  @discardableResult
  private mutating func updateRecord(
    for key: Key,
    _ update: (inout Record) -> Void
  ) -> Bool {
    let isNewRecord = records[key] == nil
    var record = records[key] ?? Record(revision: nextRevision)
    let original = record
    update(&record)
    guard isNewRecord || record != original else {
      return false
    }
    record.revision = advanceRevision()
    records[key] = record
    return true
  }

  private mutating func advanceRevision() -> Int {
    let revision = nextRevision
    nextRevision += 1
    return revision
  }

  private static func insert(sessionID: String?, processID: Int32?, into record: inout Record) {
    if let sessionID = normalizedSessionID(sessionID) {
      record.sessionIDs.insert(sessionID)
    }
    if let processID = normalizedProcessID(processID) {
      record.processIDs.insert(processID)
    }
  }

  private static func normalizedSessionID(_ sessionID: String?) -> String? {
    guard let sessionID = sessionID?.trimmingCharacters(in: .whitespacesAndNewlines),
      !sessionID.isEmpty
    else {
      return nil
    }
    return sessionID
  }

  private static func normalizedProcessID(_ processID: Int32?) -> Int32? {
    guard let processID, processID > 0 else { return nil }
    return processID
  }

  private static func sortBadgeInstances(_ lhs: Instance, _ rhs: Instance) -> Bool {
    let lhsPriority = TerminalHostState.agentActivityPriority(lhs.activity.phase)
    let rhsPriority = TerminalHostState.agentActivityPriority(rhs.activity.phase)
    if lhsPriority != rhsPriority {
      return lhsPriority > rhsPriority
    }
    if lhs.activity.kind.rawValue != rhs.activity.kind.rawValue {
      return lhs.activity.kind.rawValue < rhs.activity.kind.rawValue
    }
    if lhs.surfaceIndex != rhs.surfaceIndex {
      return lhs.surfaceIndex < rhs.surfaceIndex
    }
    return lhs.revision > rhs.revision
  }

  nonisolated static func isProcessAlive(_ processID: Int32) -> Bool {
    processID > 0 && kill(pid_t(processID), 0) == 0
  }
}
