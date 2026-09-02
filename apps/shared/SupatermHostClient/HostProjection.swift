import Foundation
import Observation

public struct HostProjectionState: Equatable, Sendable {
  public private(set) var epoch: UUID
  public private(set) var revision: UInt64
  public private(set) var structureRevision: UInt64
  public private(set) var workspace: HostWorkspace
  public private(set) var clientState: HostClientState?
  public private(set) var paneFacts: [String: HostPaneFacts]
  public private(set) var agentFacts: [String: HostAgentFact]
  public private(set) var notifications: [HostNotificationRecord]
  public private(set) var enrichments: [String: HostAgentEnrichment]

  public init(snapshot: HostModelSnapshot) {
    epoch = snapshot.epoch
    revision = snapshot.revision
    structureRevision = snapshot.structureRevision
    workspace = snapshot.workspace
    clientState = snapshot.clientState
    paneFacts = snapshot.paneFacts
    agentFacts = snapshot.agentFacts
    notifications = snapshot.notifications
    enrichments = snapshot.enrichments
  }

  public mutating func apply(_ mutation: HostMutationEvent) throws {
    guard mutation.epoch == epoch else {
      throw HostProjectionFailure.epochChanged
    }
    guard mutation.revision > revision else {
      if mutation.revision == revision { return }
      throw HostProjectionFailure.staleMutation
    }
    revision = mutation.revision
    structureRevision = mutation.structureRevision
    if let workspace = mutation.workspace {
      self.workspace = workspace
    }
    if let clientState = mutation.clientState {
      self.clientState = clientState
    }
    if let paneFacts = mutation.paneFacts {
      self.paneFacts = paneFacts
    }
    if let agentFacts = mutation.agentFacts {
      self.agentFacts = agentFacts
    }
    if let notifications = mutation.notifications {
      self.notifications = notifications
    }
    if let enrichments = mutation.enrichments {
      self.enrichments = enrichments
    }
  }

  public func paneFacts(_ id: HostPaneID) -> HostPaneFacts? {
    paneFacts[id.uuidString.lowercased()] ?? paneFacts[id.uuidString.uppercased()]
  }

  public func agentFacts(_ id: HostPaneID) -> HostAgentFact? {
    agentFacts[id.uuidString.lowercased()] ?? agentFacts[id.uuidString.uppercased()]
  }

  public func enrichment(_ id: HostPaneID) -> HostAgentEnrichment? {
    enrichments[id.uuidString.lowercased()] ?? enrichments[id.uuidString.uppercased()]
  }
}

public enum HostProjectionConnectionState: Equatable, Sendable {
  case disconnected
  case connecting
  case connected(HostWelcome)
  case failed(String)
}

@Observable
@MainActor
public final class HostProjection {
  public private(set) var state: HostProjectionState?
  public private(set) var connectionState: HostProjectionConnectionState = .disconnected

  public init() {}

  public func connecting() {
    if connectionState != .connecting {
      connectionState = .connecting
    }
  }

  public func connected(_ welcome: HostWelcome) {
    connectionState = .connected(welcome)
  }

  public func failed(_ message: String) {
    connectionState = .failed(message)
  }

  public func disconnected() {
    connectionState = .disconnected
  }

  public func clear() {
    state = nil
  }

  public func apply(_ subscription: HostSubscription) throws {
    switch subscription {
    case .snapshot(let snapshot):
      state = HostProjectionState(snapshot: snapshot)
    case .replay(let mutations):
      guard var next = state else {
        throw HostProjectionFailure.snapshotRequired
      }
      for mutation in mutations {
        try next.apply(mutation)
      }
      if next != state {
        state = next
      }
    }
  }
}

public enum HostProjectionFailure: Error, Equatable, Sendable {
  case snapshotRequired
  case epochChanged
  case staleMutation
}
