import Foundation

extension TerminalTabDragPayload {
  func sidebarPayload(
    topologyStamp: TerminalSidebarTopologyStamp
  ) -> TerminalSidebarDragPayload? {
    let source: TerminalSidebarDragSource
    switch self.source {
    case .pane(let pane):
      source = .tabs([pane.destinationTabID])
      return TerminalSidebarDragPayload(
        operationID: moveOperationID,
        source: source,
        topologyStamp: topologyStamp
      )
    case .rootItems:
      let tabIDs = itemIDs.compactMap { itemID -> TerminalTabID? in
        guard case .tab(let tabID) = itemID else { return nil }
        return tabID
      }
      if tabIDs.count == itemIDs.count {
        source = .tabs(tabIDs)
      } else if itemIDs.count == 1, case .group(let groupID) = itemIDs[0] {
        source = .group(groupID)
      } else {
        return nil
      }
    }
    return TerminalSidebarDragPayload(
      operationID: moveOperationID,
      source: source,
      topologyStamp: topologyStamp
    )
  }
}

@MainActor
struct TerminalTabDropDestinationModel {
  struct Configuration {
    let windowControllerID: UUID
    let tabDragRegistry: TerminalTabDragRegistry
    let performLocalDrop: ((TerminalSidebarDropCommand) -> TerminalSidebarDropReceipt?)?
  }

  struct Update: Equatable {
    let sidebarPayload: TerminalSidebarDragPayload
    let decision: TerminalSidebarDragTargetDecision?
    let beganSession: Bool
    let replacedSession: Bool
    let acceptsDrop: Bool
  }

  private enum Operation: Equatable {
    case local
    case transfer
  }

  private struct Context: Equatable {
    let sidebarPayload: TerminalSidebarDragPayload
    let operation: Operation
  }

  private struct Session {
    let payload: TerminalTabDragPayload
    let context: Context
    var dropTarget = TerminalSidebarDragTargetState.none
    var frozenPlan: TerminalSidebarDropPlan?

    func matches(_ payload: TerminalTabDragPayload, context: Context) -> Bool {
      self.payload == payload && self.context == context
    }
  }

  private let configuration: Configuration
  private var session: Session?

  init(configuration: Configuration) {
    self.configuration = configuration
  }

  var isActive: Bool { session != nil }

  var activePayload: TerminalTabDragPayload? { session?.payload }

  func accepts(_ payload: TerminalTabDragPayload) -> Bool {
    session?.payload == payload && session?.dropTarget.acceptsDrop == true
  }

  mutating func update(
    _ payload: TerminalTabDragPayload,
    in outline: TerminalSidebarOutline,
    path: (TerminalSidebarDragSource) -> TerminalSidebarSemanticPath?
  ) -> Update? {
    guard let context = context(for: payload, in: outline) else { return nil }
    let replacedSession = session.map { !$0.matches(payload, context: context) } == true
    if replacedSession {
      deactivateSession()
    }
    let beganSession = session == nil
    if beganSession {
      session = Session(payload: payload, context: context)
    }
    guard var session else { return nil }
    guard session.frozenPlan == nil else {
      return Update(
        sidebarPayload: session.context.sidebarPayload,
        decision: nil,
        beganSession: beganSession,
        replacedSession: replacedSession,
        acceptsDrop: false
      )
    }
    let resolution = TerminalSidebarDropResolution(
      payload: session.context.sidebarPayload,
      path: path(session.context.sidebarPayload.source),
      outline: outline
    )
    let decision = session.dropTarget.transition(TerminalSidebarDragTargetEvent(resolution))
    self.session = session
    configuration.tabDragRegistry.setSidebarDestination(
      payload,
      windowControllerID: configuration.windowControllerID,
      isActive: true
    )
    return Update(
      sidebarPayload: session.context.sidebarPayload,
      decision: decision,
      beganSession: beganSession,
      replacedSession: replacedSession,
      acceptsDrop: session.dropTarget.acceptsDrop
    )
  }

  mutating func prepare(_ payload: TerminalTabDragPayload) -> Bool {
    guard var session,
      session.payload == payload,
      let plan = session.dropTarget.plan
    else { return false }
    session.frozenPlan = plan
    self.session = session
    return true
  }

  mutating func perform(
    _ payload: TerminalTabDragPayload,
    in outline: TerminalSidebarOutline
  ) -> Bool {
    guard session?.payload == payload else { return false }
    if session?.frozenPlan == nil, !prepare(payload) { return false }
    guard
      let session,
      let plan = session.frozenPlan,
      session.context.sidebarPayload.topologyStamp == outline.topologyStamp,
      let command = plan.command(for: session.context.sidebarPayload)
    else { return false }
    switch session.context.operation {
    case .local:
      return configuration.performLocalDrop?(command) != nil
    case .transfer:
      return configuration.tabDragRegistry.performTransfer(
        payload,
        to: TerminalTabDragRegistry.Destination(
          windowControllerID: configuration.windowControllerID,
          spaceID: command.topologyStamp.spaceID,
          expectedTopologyRevision: command.topologyStamp.revision,
          placement: command.destination
        )
      ) != nil
    }
  }

  @discardableResult
  mutating func clear() -> Bool {
    guard session != nil else { return false }
    deactivateSession()
    return true
  }

  private func context(
    for payload: TerminalTabDragPayload,
    in outline: TerminalSidebarOutline
  ) -> Context? {
    guard let topologyStamp = outline.topologyStamp else { return nil }
    if configuration.performLocalDrop != nil,
      case .rootItems = payload.source,
      payload.sourceWindowID == configuration.windowControllerID,
      payload.sourceSpaceID == topologyStamp.spaceID,
      payload.sourceTopologyRevision == topologyStamp.revision,
      let sidebarPayload = payload.sidebarPayload(topologyStamp: topologyStamp)
    {
      return Context(sidebarPayload: sidebarPayload, operation: .local)
    }
    guard let sidebarPayload = payload.sidebarPayload(topologyStamp: topologyStamp) else {
      return nil
    }
    return Context(sidebarPayload: sidebarPayload, operation: .transfer)
  }

  private mutating func deactivateSession() {
    if let payload = session?.payload {
      configuration.tabDragRegistry.setSidebarDestination(
        payload,
        windowControllerID: configuration.windowControllerID,
        isActive: false
      )
    }
    session = nil
  }
}
