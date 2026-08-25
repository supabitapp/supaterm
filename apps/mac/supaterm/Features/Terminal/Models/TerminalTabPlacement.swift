import Foundation

nonisolated struct TerminalProjectSectionItem: Identifiable, Equatable, Sendable {
  let project: TerminalProject
  var tabs: [TerminalTabItem]

  var id: TerminalProjectID { project.id }
}

nonisolated struct TerminalUnassignedSectionItem: Equatable, Sendable {
  var tabs: [TerminalTabItem]
}

nonisolated struct TerminalTabPlacement: Equatable, Sendable {
  let projectID: TerminalProjectID?
  let isPinned: Bool
  let index: Int
}

nonisolated struct TerminalTabMoveOperationID: Hashable, Sendable {
  let rawValue: UUID

  init(rawValue: UUID = UUID()) {
    self.rawValue = rawValue
  }
}

nonisolated struct TerminalTabMoveRequest: Equatable, Sendable {
  let operationID: TerminalTabMoveOperationID
  let expectedTopologyRevision: UInt64
  let orderedProjectIDs: [TerminalProjectID]
  let tabIDs: [TerminalTabID]
  let destination: TerminalTabPlacement

  init(
    operationID: TerminalTabMoveOperationID = TerminalTabMoveOperationID(),
    expectedTopologyRevision: UInt64,
    orderedProjectIDs: [TerminalProjectID],
    tabIDs: [TerminalTabID],
    destination: TerminalTabPlacement
  ) {
    self.operationID = operationID
    self.expectedTopologyRevision = expectedTopologyRevision
    self.orderedProjectIDs = orderedProjectIDs
    self.tabIDs = tabIDs
    self.destination = destination
  }
}

nonisolated struct TerminalTabMoveResult: Equatable, Sendable {
  let operationID: TerminalTabMoveOperationID
  let tabIDs: [TerminalTabID]
  let location: TerminalTabPlacement
  let topologyRevision: UInt64
}

nonisolated struct TerminalProjectCreationResult: Equatable, Sendable {
  let projectID: TerminalProjectID
}

nonisolated struct TerminalTabExtractionRequest: Equatable, Sendable {
  let expectedTopologyRevision: UInt64
  let tabIDs: [TerminalTabID]
}

nonisolated struct TerminalTabTransferRequest: Equatable, Sendable {
  let expectedSourceRevision: UInt64
  let expectedDestinationRevision: UInt64
  let orderedProjectIDs: [TerminalProjectID]
  let tabIDs: [TerminalTabID]
  let destination: TerminalTabPlacement
}

nonisolated struct TerminalTabTransferResult: Equatable, Sendable {
  let tabIDs: [TerminalTabID]
}

nonisolated enum TerminalTabTransferError: Error, Equatable {
  case destinationContainsSurface
  case destinationContainsTab(TerminalTabID)
  case incompatibleRuntime
  case invalidSplitDestination
  case invalidSpace
  case missingLiveTree
  case sameCollection
  case staleDestination(expected: UInt64, actual: UInt64)
  case staleSource(expected: UInt64, actual: UInt64)
  case topology(TerminalTabMoveError)
}

nonisolated enum TerminalTabMoveError: Error, Equatable {
  case duplicateTab(TerminalTabID)
  case emptyTabs
  case invalidDestination(TerminalTabPlacement)
  case staleProjects
  case staleTopology(expected: UInt64, actual: UInt64)
  case tabNotFound(TerminalTabID)
}
