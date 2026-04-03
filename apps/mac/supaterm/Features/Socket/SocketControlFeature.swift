import ComposableArchitecture
import Foundation
import Sharing
import SupatermCLIShared

private enum SocketControlCancelID {
  static let requests = "SocketControlFeature.requests"
}

private enum SocketRequestError: Error, Equatable, LocalizedError {
  case invalidIndex(String)
  case missingTarget
  case missingSpaceTarget
  case onboardingUnavailable
  case paneRequiresTab
  case spaceRequiresTab
  case tabRequiresSpace
  case windowRequiresSpace

  var errorDescription: String? {
    switch self {
    case .invalidIndex(let field):
      return "\(field) must be 1 or greater."
    case .missingTarget:
      return "Provide a target space and tab or run the command inside a Supaterm pane."
    case .missingSpaceTarget:
      return "Provide a target space or run the command inside a Supaterm pane."
    case .onboardingUnavailable:
      return "No Supaterm window is available."
    case .paneRequiresTab:
      return "pane target requires a tab target."
    case .spaceRequiresTab:
      return "space target requires a tab target."
    case .tabRequiresSpace:
      return "tab target requires a space target."
    case .windowRequiresSpace:
      return "window target requires a space target."
    }
  }
}

@Reducer
struct SocketControlFeature {
  @ObservableState
  struct State: Equatable {
    var endpoint: SupatermSocketEndpoint?
    var startErrorMessage: String?
  }

  enum Action {
    case requestReceived(SocketControlClient.Request)
    case shutdown
    case started(SupatermSocketEndpoint)
    case startFailed(String)
    case task
  }

  @Dependency(SocketControlClient.self) var socketControlClient
  @Dependency(DesktopNotificationClient.self) var desktopNotificationClient
  @Dependency(TerminalWindowsClient.self) var terminalWindowsClient

  var body: some Reducer<State, Action> {
    Reduce { state, action in
      switch action {
      case .requestReceived(let request):
        return .run { [desktopNotificationClient, socketControlClient, terminalWindowsClient] _ in
          let response = await response(
            for: request.payload,
            desktopNotificationClient: desktopNotificationClient,
            socketControlClient: socketControlClient,
            terminalWindowsClient: terminalWindowsClient
          )
          await socketControlClient.reply(request.handle, response)
        }

      case .started(let endpoint):
        state.endpoint = endpoint
        state.startErrorMessage = nil
        return .none

      case .startFailed(let message):
        state.startErrorMessage = message
        return .none

      case .shutdown:
        return .merge(
          .cancel(id: SocketControlCancelID.requests),
          .run { [socketControlClient] _ in
            await socketControlClient.stop()
          }
        )

      case .task:
        return .run { [socketControlClient] send in
          do {
            let endpoint = try await socketControlClient.start()
            await send(.started(endpoint))
            let requests = await socketControlClient.requests()
            for await request in requests {
              await send(.requestReceived(request))
            }
          } catch {
            await send(.startFailed(error.localizedDescription))
          }
        }
        .cancellable(id: SocketControlCancelID.requests, cancelInFlight: true)
      }
    }
  }

  private func response(
    for request: SupatermSocketRequest,
    desktopNotificationClient: DesktopNotificationClient,
    socketControlClient: SocketControlClient,
    terminalWindowsClient: TerminalWindowsClient
  ) async -> SupatermSocketResponse {
    do {
      return try await responseResult(
        for: request,
        desktopNotificationClient: desktopNotificationClient,
        socketControlClient: socketControlClient,
        terminalWindowsClient: terminalWindowsClient
      )
    } catch let error as SocketRequestError {
      return .error(
        id: request.id,
        code: "invalid_request",
        message: error.localizedDescription
      )
    } catch let error as AgentHookError {
      return .error(
        id: request.id,
        code: "invalid_request",
        message: error.localizedDescription
      )
    } catch let error as DecodingError {
      return .error(
        id: request.id,
        code: "invalid_request",
        message: error.localizedDescription
      )
    } catch let error as SupatermSocketProtocolError {
      return .error(
        id: request.id,
        code: "invalid_request",
        message: error.localizedDescription
      )
    } catch let error as TerminalCreateTabError {
      return createTabErrorResponse(error, requestID: request.id)
    } catch let error as TerminalCreatePaneError {
      return terminalErrorResponse(error, requestID: request.id)
    } catch let error as TerminalControlError {
      return controlErrorResponse(error, requestID: request.id)
    } catch {
      return .error(
        id: request.id,
        code: "internal_error",
        message: error.localizedDescription
      )
    }
  }

  private func responseResult(
    for request: SupatermSocketRequest,
    desktopNotificationClient: DesktopNotificationClient,
    socketControlClient: SocketControlClient,
    terminalWindowsClient: TerminalWindowsClient
  ) async throws -> SupatermSocketResponse {
    switch request.method {
    case SupatermSocketMethod.appOnboarding:
      guard let snapshot = await terminalWindowsClient.onboardingSnapshot() else {
        throw SocketRequestError.onboardingUnavailable
      }
      return try .ok(id: request.id, encodableResult: snapshot)

    case SupatermSocketMethod.appDebug:
      let payload = try request.decodeParams(SupatermDebugRequest.self)
      let snapshot = await terminalWindowsClient.debugSnapshot(payload)
      return try .ok(id: request.id, encodableResult: snapshot)

    case SupatermSocketMethod.appTree:
      let snapshot = await terminalWindowsClient.treeSnapshot()
      return try .ok(id: request.id, encodableResult: snapshot)

    case SupatermSocketMethod.systemIdentity:
      guard let endpoint = await socketControlClient.currentEndpoint() else {
        return .error(
          id: request.id,
          code: "internal_error",
          message: "Supaterm socket endpoint is unavailable."
        )
      }
      return try .ok(id: request.id, encodableResult: endpoint)

    case SupatermSocketMethod.systemPing:
      return .ok(id: request.id, result: ["pong": true])

    case SupatermSocketMethod.terminalNotify:
      let payload = try request.decodeParams(SupatermNotifyRequest.self)
      let notifyRequest = try notifyRequest(from: payload)
      let result = try await terminalWindowsClient.notify(notifyRequest)
      @Shared(.appPrefs) var appPrefs = .default
      if appPrefs.systemNotificationsEnabled && result.desktopNotificationDisposition.shouldDeliver
      {
        await desktopNotificationClient.deliver(
          .init(
            body: payload.body,
            subtitle: payload.subtitle,
            title: result.resolvedTitle
          )
        )
      }
      return try .ok(id: request.id, encodableResult: result)

    case SupatermSocketMethod.terminalAgentHook:
      let payload = try request.decodeParams(SupatermAgentHookRequest.self)
      let result = try await terminalWindowsClient.agentHook(payload)
      @Shared(.appPrefs) var appPrefs = .default
      if appPrefs.systemNotificationsEnabled, let desktopNotification = result.desktopNotification {
        await desktopNotificationClient.deliver(desktopNotification)
      }
      return .ok(id: request.id)

    default:
      if let response = try await terminalControlResponseResult(
        for: request,
        terminalWindowsClient: terminalWindowsClient
      ) {
        return response
      }
      return .error(
        id: request.id,
        code: "method_not_found",
        message: "Unknown method '\(request.method)'."
      )
    }
  }

  private func terminalControlResponseResult(
    for request: SupatermSocketRequest,
    terminalWindowsClient: TerminalWindowsClient
  ) async throws -> SupatermSocketResponse? {
    if let response = try await terminalCreationResponseResult(
      for: request,
      terminalWindowsClient: terminalWindowsClient
    ) {
      return response
    }
    if let response = try await terminalPaneResponseResult(
      for: request,
      terminalWindowsClient: terminalWindowsClient
    ) {
      return response
    }
    if let response = try await terminalTabResponseResult(
      for: request,
      terminalWindowsClient: terminalWindowsClient
    ) {
      return response
    }
    return try await terminalSpaceResponseResult(
      for: request,
      terminalWindowsClient: terminalWindowsClient
    )
  }

  private func terminalCreationResponseResult(
    for request: SupatermSocketRequest,
    terminalWindowsClient: TerminalWindowsClient
  ) async throws -> SupatermSocketResponse? {
    switch request.method {
    case SupatermSocketMethod.terminalNewTab:
      let payload = try request.decodeParams(SupatermNewTabRequest.self)
      let createTabRequest = try createTabRequest(from: payload)
      let result = try await terminalWindowsClient.createTab(createTabRequest)
      return try .ok(id: request.id, encodableResult: result)

    case SupatermSocketMethod.terminalNewPane:
      let payload = try request.decodeParams(SupatermNewPaneRequest.self)
      let createPaneRequest = try createPaneRequest(from: payload)
      let result = try await terminalWindowsClient.createPane(createPaneRequest)
      return try .ok(id: request.id, encodableResult: result)

    default:
      return nil
    }
  }

  private func terminalPaneResponseResult(
    for request: SupatermSocketRequest,
    terminalWindowsClient: TerminalWindowsClient
  ) async throws -> SupatermSocketResponse? {
    switch request.method {
    case SupatermSocketMethod.terminalFocusPane:
      let payload = try request.decodeParams(SupatermPaneTargetRequest.self)
      let result = try await terminalWindowsClient.focusPane(try createPaneTarget(from: payload))
      return try .ok(id: request.id, encodableResult: result)

    case SupatermSocketMethod.terminalLastPane:
      let payload = try request.decodeParams(SupatermPaneTargetRequest.self)
      let result = try await terminalWindowsClient.lastPane(try createPaneTarget(from: payload))
      return try .ok(id: request.id, encodableResult: result)

    case SupatermSocketMethod.terminalClosePane:
      let payload = try request.decodeParams(SupatermPaneTargetRequest.self)
      let result = try await terminalWindowsClient.closePane(try createPaneTarget(from: payload))
      return try .ok(id: request.id, encodableResult: result)

    case SupatermSocketMethod.terminalSendText:
      let payload = try request.decodeParams(SupatermSendTextRequest.self)
      let result = try await terminalWindowsClient.sendText(
        .init(
          target: try createPaneTarget(from: payload.target),
          text: payload.text
        )
      )
      return try .ok(id: request.id, encodableResult: result)

    case SupatermSocketMethod.terminalCapturePane:
      let payload = try request.decodeParams(SupatermCapturePaneRequest.self)
      let result = try await terminalWindowsClient.capturePane(
        .init(
          lines: payload.lines,
          scope: payload.scope,
          target: try createPaneTarget(from: payload.target)
        )
      )
      return try .ok(id: request.id, encodableResult: result)

    case SupatermSocketMethod.terminalResizePane:
      let payload = try request.decodeParams(SupatermResizePaneRequest.self)
      let result = try await terminalWindowsClient.resizePane(
        .init(
          amount: payload.amount,
          direction: payload.direction,
          target: try createPaneTarget(from: payload.target)
        )
      )
      return try .ok(id: request.id, encodableResult: result)

    default:
      return nil
    }
  }

  private func terminalTabResponseResult(
    for request: SupatermSocketRequest,
    terminalWindowsClient: TerminalWindowsClient
  ) async throws -> SupatermSocketResponse? {
    switch request.method {
    case SupatermSocketMethod.terminalTilePanes:
      let payload = try request.decodeParams(SupatermTabTargetRequest.self)
      let result = try await terminalWindowsClient.tilePanes(
        .init(target: try createTabTarget(from: payload))
      )
      return try .ok(id: request.id, encodableResult: result)

    case SupatermSocketMethod.terminalEqualizePanes:
      let payload = try request.decodeParams(SupatermTabTargetRequest.self)
      let result = try await terminalWindowsClient.equalizePanes(
        .init(target: try createTabTarget(from: payload))
      )
      return try .ok(id: request.id, encodableResult: result)

    case SupatermSocketMethod.terminalSelectTab:
      let payload = try request.decodeParams(SupatermTabTargetRequest.self)
      let result = try await terminalWindowsClient.selectTab(try createTabTarget(from: payload))
      return try .ok(id: request.id, encodableResult: result)

    case SupatermSocketMethod.terminalCloseTab:
      let payload = try request.decodeParams(SupatermTabTargetRequest.self)
      let result = try await terminalWindowsClient.closeTab(try createTabTarget(from: payload))
      return try .ok(id: request.id, encodableResult: result)

    case SupatermSocketMethod.terminalRenameTab:
      let payload = try request.decodeParams(SupatermRenameTabRequest.self)
      let result = try await terminalWindowsClient.renameTab(
        .init(
          target: try createTabTarget(from: payload.target),
          title: payload.title
        )
      )
      return try .ok(id: request.id, encodableResult: result)

    case SupatermSocketMethod.terminalNextTab:
      let payload = try request.decodeParams(SupatermTabNavigationRequest.self)
      let result = try await terminalWindowsClient.nextTab(
        createTabNavigationRequest(from: payload))
      return try .ok(id: request.id, encodableResult: result)

    case SupatermSocketMethod.terminalPreviousTab:
      let payload = try request.decodeParams(SupatermTabNavigationRequest.self)
      let result = try await terminalWindowsClient.previousTab(
        createTabNavigationRequest(from: payload))
      return try .ok(id: request.id, encodableResult: result)

    case SupatermSocketMethod.terminalLastTab:
      let payload = try request.decodeParams(SupatermTabNavigationRequest.self)
      let result = try await terminalWindowsClient.lastTab(
        createTabNavigationRequest(from: payload))
      return try .ok(id: request.id, encodableResult: result)

    default:
      return nil
    }
  }

  private func terminalSpaceResponseResult(
    for request: SupatermSocketRequest,
    terminalWindowsClient: TerminalWindowsClient
  ) async throws -> SupatermSocketResponse? {
    switch request.method {
    case SupatermSocketMethod.terminalCreateSpace:
      let payload = try request.decodeParams(SupatermCreateSpaceRequest.self)
      let result = try await terminalWindowsClient.createSpace(
        .init(
          name: payload.name,
          target: createSpaceNavigationRequest(from: payload.target)
        )
      )
      return try .ok(id: request.id, encodableResult: result)

    case SupatermSocketMethod.terminalSelectSpace:
      let payload = try request.decodeParams(SupatermSpaceTargetRequest.self)
      let result = try await terminalWindowsClient.selectSpace(try createSpaceTarget(from: payload))
      return try .ok(id: request.id, encodableResult: result)

    case SupatermSocketMethod.terminalCloseSpace:
      let payload = try request.decodeParams(SupatermSpaceTargetRequest.self)
      let result = try await terminalWindowsClient.closeSpace(try createSpaceTarget(from: payload))
      return try .ok(id: request.id, encodableResult: result)

    case SupatermSocketMethod.terminalRenameSpace:
      let payload = try request.decodeParams(SupatermRenameSpaceRequest.self)
      let result = try await terminalWindowsClient.renameSpace(
        .init(
          name: payload.name,
          target: try createSpaceTarget(from: payload.target)
        )
      )
      return try .ok(id: request.id, encodableResult: result)

    case SupatermSocketMethod.terminalNextSpace:
      let payload = try request.decodeParams(SupatermSpaceNavigationRequest.self)
      let result = try await terminalWindowsClient.nextSpace(
        createSpaceNavigationRequest(from: payload))
      return try .ok(id: request.id, encodableResult: result)

    case SupatermSocketMethod.terminalPreviousSpace:
      let payload = try request.decodeParams(SupatermSpaceNavigationRequest.self)
      let result = try await terminalWindowsClient.previousSpace(
        createSpaceNavigationRequest(from: payload))
      return try .ok(id: request.id, encodableResult: result)

    case SupatermSocketMethod.terminalLastSpace:
      let payload = try request.decodeParams(SupatermSpaceNavigationRequest.self)
      let result = try await terminalWindowsClient.lastSpace(
        createSpaceNavigationRequest(from: payload))
      return try .ok(id: request.id, encodableResult: result)

    default:
      return nil
    }
  }

  private func createTabRequest(
    from payload: SupatermNewTabRequest
  ) throws -> TerminalCreateTabRequest {
    try validateCreateTabPayload(payload)

    return .init(
      command: payload.command,
      cwd: payload.cwd,
      focus: payload.focus,
      target: try createTabTarget(from: payload)
    )
  }

  private func validateCreateTabPayload(
    _ payload: SupatermNewTabRequest
  ) throws {
    if let windowIndex = payload.targetWindowIndex, windowIndex < 1 {
      throw SocketRequestError.invalidIndex("window")
    }
    if let spaceIndex = payload.targetSpaceIndex, spaceIndex < 1 {
      throw SocketRequestError.invalidIndex("space")
    }
    if payload.targetWindowIndex != nil && payload.targetSpaceIndex == nil {
      throw SocketRequestError.windowRequiresSpace
    }
  }

  private func createTabTarget(
    from payload: SupatermNewTabRequest
  ) throws -> TerminalCreateTabRequest.Target {
    switch payload.targetSpaceIndex {
    case .some(let spaceIndex):
      return .space(
        windowIndex: payload.targetWindowIndex ?? 1,
        spaceIndex: spaceIndex
      )

    case .none:
      guard let contextPaneID = payload.contextPaneID else {
        throw SocketRequestError.missingSpaceTarget
      }
      if payload.targetWindowIndex != nil {
        throw SocketRequestError.windowRequiresSpace
      }
      return .contextPane(contextPaneID)
    }
  }

  private func createPaneRequest(
    from payload: SupatermNewPaneRequest
  ) throws -> TerminalCreatePaneRequest {
    try validateCreatePanePayload(payload)

    return .init(
      command: payload.command,
      direction: payload.direction,
      focus: payload.focus,
      equalize: payload.equalize,
      target: try createPaneTarget(from: payload)
    )
  }

  private func notifyRequest(
    from payload: SupatermNotifyRequest
  ) throws -> TerminalNotifyRequest {
    try validateTargetPayload(
      windowIndex: payload.targetWindowIndex,
      spaceIndex: payload.targetSpaceIndex,
      tabIndex: payload.targetTabIndex,
      paneIndex: payload.targetPaneIndex
    )

    return .init(
      body: payload.body,
      subtitle: payload.subtitle,
      target: try createNotifyTarget(from: payload),
      title: payload.title
    )
  }

  private func validateCreatePanePayload(
    _ payload: SupatermNewPaneRequest
  ) throws {
    try validateTargetPayload(
      windowIndex: payload.targetWindowIndex,
      spaceIndex: payload.targetSpaceIndex,
      tabIndex: payload.targetTabIndex,
      paneIndex: payload.targetPaneIndex
    )
  }

  private func validateTargetPayload(
    windowIndex: Int?,
    spaceIndex: Int?,
    tabIndex: Int?,
    paneIndex: Int?
  ) throws {
    if let windowIndex, windowIndex < 1 {
      throw SocketRequestError.invalidIndex("window")
    }
    if let spaceIndex, spaceIndex < 1 {
      throw SocketRequestError.invalidIndex("space")
    }
    if let tabIndex, tabIndex < 1 {
      throw SocketRequestError.invalidIndex("tab")
    }
    if let paneIndex, paneIndex < 1 {
      throw SocketRequestError.invalidIndex("pane")
    }
    if paneIndex != nil && tabIndex == nil {
      throw SocketRequestError.paneRequiresTab
    }
    if tabIndex != nil && spaceIndex == nil {
      throw SocketRequestError.tabRequiresSpace
    }
    if spaceIndex != nil && tabIndex == nil {
      throw SocketRequestError.spaceRequiresTab
    }
    if windowIndex != nil && spaceIndex == nil {
      throw SocketRequestError.windowRequiresSpace
    }
  }

  private func createPaneTarget(
    from payload: SupatermNewPaneRequest
  ) throws -> TerminalCreatePaneRequest.Target {
    switch (payload.targetSpaceIndex, payload.targetTabIndex, payload.targetPaneIndex) {
    case (nil, nil, nil):
      guard let contextPaneID = payload.contextPaneID else {
        throw SocketRequestError.missingTarget
      }
      if payload.targetWindowIndex != nil {
        throw SocketRequestError.windowRequiresSpace
      }
      return .contextPane(contextPaneID)

    case (.some, .some, nil):
      return .tab(
        windowIndex: payload.targetWindowIndex ?? 1,
        spaceIndex: payload.targetSpaceIndex!,
        tabIndex: payload.targetTabIndex!
      )

    case (.some, .some, .some):
      return .pane(
        windowIndex: payload.targetWindowIndex ?? 1,
        spaceIndex: payload.targetSpaceIndex!,
        tabIndex: payload.targetTabIndex!,
        paneIndex: payload.targetPaneIndex!
      )

    case (.none, .some, _):
      throw SocketRequestError.tabRequiresSpace
    case (.some, .none, _):
      throw SocketRequestError.spaceRequiresTab
    case (.none, .none, .some):
      throw SocketRequestError.paneRequiresTab
    }
  }

  private func createTabErrorResponse(
    _ error: TerminalCreateTabError,
    requestID: String
  ) -> SupatermSocketResponse {
    switch error {
    case .contextPaneNotFound:
      return .error(
        id: requestID,
        code: "not_found",
        message: "The current pane could not be resolved."
      )

    case .creationFailed:
      return .error(
        id: requestID,
        code: "internal_error",
        message: "Failed to create a new tab."
      )

    case .spaceNotFound(let windowIndex, let spaceIndex):
      return .error(
        id: requestID,
        code: "not_found",
        message: "Space \(spaceIndex) was not found in window \(windowIndex)."
      )

    case .windowNotFound(let windowIndex):
      return .error(
        id: requestID,
        code: "not_found",
        message: "Window \(windowIndex) was not found."
      )
    }
  }

  private func createSpaceTarget(
    from payload: SupatermSpaceTargetRequest
  ) throws -> TerminalSpaceTarget {
    if let windowIndex = payload.targetWindowIndex, windowIndex < 1 {
      throw SocketRequestError.invalidIndex("window")
    }
    if let spaceIndex = payload.targetSpaceIndex, spaceIndex < 1 {
      throw SocketRequestError.invalidIndex("space")
    }

    if let spaceIndex = payload.targetSpaceIndex {
      return .space(windowIndex: payload.targetWindowIndex ?? 1, spaceIndex: spaceIndex)
    }
    guard let contextPaneID = payload.contextPaneID else {
      throw SocketRequestError.missingSpaceTarget
    }
    if payload.targetWindowIndex != nil {
      throw SocketRequestError.windowRequiresSpace
    }
    return .contextPane(contextPaneID)
  }

  private func createTabTarget(
    from payload: SupatermTabTargetRequest
  ) throws -> TerminalTabTarget {
    if let windowIndex = payload.targetWindowIndex, windowIndex < 1 {
      throw SocketRequestError.invalidIndex("window")
    }
    if let spaceIndex = payload.targetSpaceIndex, spaceIndex < 1 {
      throw SocketRequestError.invalidIndex("space")
    }
    if let tabIndex = payload.targetTabIndex, tabIndex < 1 {
      throw SocketRequestError.invalidIndex("tab")
    }

    switch (payload.targetSpaceIndex, payload.targetTabIndex) {
    case (.some, .some):
      return .tab(
        windowIndex: payload.targetWindowIndex ?? 1,
        spaceIndex: payload.targetSpaceIndex!,
        tabIndex: payload.targetTabIndex!
      )

    case (.none, .none):
      guard let contextPaneID = payload.contextPaneID else {
        throw SocketRequestError.missingTarget
      }
      if payload.targetWindowIndex != nil {
        throw SocketRequestError.windowRequiresSpace
      }
      return .contextPane(contextPaneID)

    case (.none, .some):
      throw SocketRequestError.tabRequiresSpace
    case (.some, .none):
      throw SocketRequestError.spaceRequiresTab
    }
  }

  private func createPaneTarget(
    from payload: SupatermPaneTargetRequest
  ) throws -> TerminalPaneTarget {
    if let windowIndex = payload.targetWindowIndex, windowIndex < 1 {
      throw SocketRequestError.invalidIndex("window")
    }
    if let spaceIndex = payload.targetSpaceIndex, spaceIndex < 1 {
      throw SocketRequestError.invalidIndex("space")
    }
    if let tabIndex = payload.targetTabIndex, tabIndex < 1 {
      throw SocketRequestError.invalidIndex("tab")
    }
    if let paneIndex = payload.targetPaneIndex, paneIndex < 1 {
      throw SocketRequestError.invalidIndex("pane")
    }

    switch (payload.targetSpaceIndex, payload.targetTabIndex, payload.targetPaneIndex) {
    case (.some, .some, .some):
      return .pane(
        windowIndex: payload.targetWindowIndex ?? 1,
        spaceIndex: payload.targetSpaceIndex!,
        tabIndex: payload.targetTabIndex!,
        paneIndex: payload.targetPaneIndex!
      )

    case (.none, .none, .none):
      guard let contextPaneID = payload.contextPaneID else {
        throw SocketRequestError.missingTarget
      }
      if payload.targetWindowIndex != nil {
        throw SocketRequestError.windowRequiresSpace
      }
      return .contextPane(contextPaneID)

    case (.none, .some, _):
      throw SocketRequestError.tabRequiresSpace
    case (.some, .none, _):
      throw SocketRequestError.spaceRequiresTab
    case (.some, .some, .none):
      throw SocketRequestError.paneRequiresTab
    case (.none, .none, .some):
      throw SocketRequestError.paneRequiresTab
    }
  }

  private func createSpaceNavigationRequest(
    from payload: SupatermSpaceNavigationRequest
  ) -> TerminalSpaceNavigationRequest {
    .init(
      contextPaneID: payload.contextPaneID,
      windowIndex: payload.targetWindowIndex
    )
  }

  private func createTabNavigationRequest(
    from payload: SupatermTabNavigationRequest
  ) -> TerminalTabNavigationRequest {
    .init(
      contextPaneID: payload.contextPaneID,
      spaceIndex: payload.targetSpaceIndex,
      windowIndex: payload.targetWindowIndex
    )
  }

  private func createNotifyTarget(
    from payload: SupatermNotifyRequest
  ) throws -> TerminalNotifyRequest.Target {
    switch (payload.targetSpaceIndex, payload.targetTabIndex, payload.targetPaneIndex) {
    case (nil, nil, nil):
      guard let contextPaneID = payload.contextPaneID else {
        throw SocketRequestError.missingTarget
      }
      if payload.targetWindowIndex != nil {
        throw SocketRequestError.windowRequiresSpace
      }
      return .contextPane(contextPaneID)

    case (.some, .some, nil):
      return .tab(
        windowIndex: payload.targetWindowIndex ?? 1,
        spaceIndex: payload.targetSpaceIndex!,
        tabIndex: payload.targetTabIndex!
      )

    case (.some, .some, .some):
      return .pane(
        windowIndex: payload.targetWindowIndex ?? 1,
        spaceIndex: payload.targetSpaceIndex!,
        tabIndex: payload.targetTabIndex!,
        paneIndex: payload.targetPaneIndex!
      )

    case (.none, .some, _):
      throw SocketRequestError.tabRequiresSpace
    case (.some, .none, _):
      throw SocketRequestError.spaceRequiresTab
    case (.none, .none, .some):
      throw SocketRequestError.paneRequiresTab
    }
  }

  private func terminalErrorResponse(
    _ error: TerminalCreatePaneError,
    requestID: String
  ) -> SupatermSocketResponse {
    switch error {
    case .contextPaneNotFound:
      return .error(
        id: requestID,
        code: "not_found",
        message: "The current pane could not be resolved."
      )

    case .creationFailed:
      return .error(
        id: requestID,
        code: "internal_error",
        message: "Failed to create a new pane."
      )

    case .paneNotFound(let windowIndex, let spaceIndex, let tabIndex, let paneIndex):
      return .error(
        id: requestID,
        code: "not_found",
        message:
          "Pane \(paneIndex) was not found in tab \(tabIndex) of space \(spaceIndex) of window \(windowIndex)."
      )

    case .spaceNotFound(let windowIndex, let spaceIndex):
      return .error(
        id: requestID,
        code: "not_found",
        message: "Space \(spaceIndex) was not found in window \(windowIndex)."
      )

    case .tabNotFound(let windowIndex, let spaceIndex, let tabIndex):
      return .error(
        id: requestID,
        code: "not_found",
        message: "Tab \(tabIndex) was not found in space \(spaceIndex) of window \(windowIndex)."
      )

    case .windowNotFound(let windowIndex):
      return .error(
        id: requestID,
        code: "not_found",
        message: "Window \(windowIndex) was not found."
      )
    }
  }

  private func controlErrorResponse(
    _ error: TerminalControlError,
    requestID: String
  ) -> SupatermSocketResponse {
    switch error {
    case .captureFailed:
      return .error(
        id: requestID,
        code: "internal_error",
        message: "Failed to capture pane text."
      )

    case .contextPaneNotFound:
      return .error(
        id: requestID,
        code: "not_found",
        message: "The current pane could not be resolved."
      )

    case .lastPaneNotFound:
      return .error(
        id: requestID,
        code: "not_found",
        message: "No previously focused pane was found."
      )

    case .lastSpaceNotFound:
      return .error(
        id: requestID,
        code: "not_found",
        message: "No previously selected space was found."
      )

    case .lastTabNotFound:
      return .error(
        id: requestID,
        code: "not_found",
        message: "No previously selected tab was found."
      )

    case .paneNotFound(let windowIndex, let spaceIndex, let tabIndex, let paneIndex):
      return .error(
        id: requestID,
        code: "not_found",
        message:
          "Pane \(paneIndex) was not found in tab \(tabIndex) of space \(spaceIndex) of window \(windowIndex)."
      )

    case .resizeFailed:
      return .error(
        id: requestID,
        code: "internal_error",
        message: "Failed to resize the pane."
      )

    case .spaceNotFound(let windowIndex, let spaceIndex):
      return .error(
        id: requestID,
        code: "not_found",
        message: "Space \(spaceIndex) was not found in window \(windowIndex)."
      )

    case .tabNotFound(let windowIndex, let spaceIndex, let tabIndex):
      return .error(
        id: requestID,
        code: "not_found",
        message: "Tab \(tabIndex) was not found in space \(spaceIndex) of window \(windowIndex)."
      )

    case .windowNotFound(let windowIndex):
      return .error(
        id: requestID,
        code: "not_found",
        message: "Window \(windowIndex) was not found."
      )
    }
  }
}
