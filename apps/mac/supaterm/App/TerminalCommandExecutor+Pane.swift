import CoreGraphics
import Foundation
import SupatermCLIShared
import SupatermTerminalCore

extension TerminalCommandExecutor {
  func agentDetectionExplain(
    _ target: TerminalPaneTarget
  ) throws -> SupatermAgentExplainResult {
    try executeTargeted(
      operation: { try $0.terminal.agentDetectionExplain(target) },
      rewrite: { result, windowIndex in
        SupatermAgentExplainResult(
          target: TerminalWindowRegistry.rewrite(result.target, windowIndex: windowIndex),
          mode: result.mode,
          status: result.status,
          rules: result.rules,
          agent: result.agent,
          process: result.process,
          ruleID: result.ruleID
        )
      }
    )
  }

  func focusPane(_ target: TerminalPaneTarget) throws -> SupatermFocusPaneResult {
    try executeTargeted(
      operation: { try $0.terminal.focusPane(target) },
      rewrite: TerminalWindowRegistry.rewrite
    )
  }

  func lastPane(_ target: TerminalPaneTarget) throws -> SupatermFocusPaneResult {
    try executeTargeted(
      operation: { try $0.terminal.lastPane(target) },
      rewrite: TerminalWindowRegistry.rewrite
    )
  }

  func closePane(_ target: TerminalPaneTarget) throws -> SupatermClosePaneResult {
    for (offset, entry) in registry.activeEntries().enumerated() {
      do {
        let resolvedClose = try entry.terminal.resolveClose(target)
        if resolvedClose.shouldCloseWindow, let window = entry.windowReference.value {
          registry.closeWindow(ObjectIdentifier(window))
          return TerminalWindowRegistry.rewrite(resolvedClose.result, windowIndex: offset + 1)
        }
        return TerminalWindowRegistry.rewrite(
          try entry.terminal.closePane(target),
          windowIndex: offset + 1
        )
      } catch TerminalControlError.contextPaneNotFound {
        continue
      }
    }
    throw TerminalControlError.contextPaneNotFound
  }

  func sendText(_ request: TerminalSendTextRequest) throws -> SupatermSendTextResult {
    try executeTargeted(
      operation: { try $0.terminal.sendText(request) },
      rewrite: TerminalWindowRegistry.rewrite
    )
  }

  func sendKey(_ request: TerminalSendKeyRequest) throws -> SupatermSendKeyResult {
    try executeTargeted(
      operation: { try $0.terminal.sendKey(request) },
      rewrite: TerminalWindowRegistry.rewrite
    )
  }

  func capturePane(_ request: TerminalCapturePaneRequest) throws -> SupatermCapturePaneResult {
    try executeTargeted(
      operation: { try $0.terminal.capturePane(request) },
      rewrite: TerminalWindowRegistry.rewrite
    )
  }

  func screenshotPane(_ target: TerminalPaneTarget) async throws -> SupatermScreenshotPaneResult {
    let capture = paneCaptureClient.capture
    let (resolvedTarget, surface):
      (
        target: SupatermPaneTarget,
        surface: GhosttySurfaceView
      ) =
        try executeTargeted(
          operation: { entry in
            let resolvedTarget = try entry.terminal.resolvePaneTarget(target)
            return (
              target: try entry.terminal.paneTarget(
                spaceID: resolvedTarget.spaceID,
                tabID: resolvedTarget.tabID,
                surfaceID: resolvedTarget.anchorSurface.id,
                tree: resolvedTarget.tree
              ),
              surface: resolvedTarget.anchorSurface
            )
          },
          rewrite: { result, windowIndex in
            (
              target: TerminalWindowRegistry.rewrite(result.target, windowIndex: windowIndex),
              surface: result.surface
            )
          }
        )
    guard
      let image = await capture(surface),
      let pngData = TerminalPNGEncoder.data(for: image)
    else {
      throw TerminalControlError.screenshotFailed
    }
    return SupatermScreenshotPaneResult(target: resolvedTarget, pngData: pngData)
  }

  func paneHealth(_ request: TerminalPaneHealthRequest) throws -> SupatermPaneHealthResult {
    try executeTargeted(
      operation: { try $0.terminal.paneHealth(request) },
      rewrite: TerminalWindowRegistry.rewrite
    )
  }

  func resizePane(_ request: TerminalResizePaneRequest) throws -> SupatermResizePaneResult {
    try executeTargeted(
      operation: { try $0.terminal.resizePane(request) },
      rewrite: TerminalWindowRegistry.rewrite
    )
  }

  func setPaneSize(_ request: TerminalSetPaneSizeRequest) throws -> SupatermSetPaneSizeResult {
    try executeTargeted(
      operation: { try $0.terminal.setPaneSize(request) },
      rewrite: TerminalWindowRegistry.rewrite
    )
  }
}
