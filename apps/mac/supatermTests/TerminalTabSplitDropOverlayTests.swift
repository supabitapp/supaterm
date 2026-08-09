import AppKit
import Testing

@testable import supaterm

struct TerminalTabSplitDropOverlayTests {
  @Test
  func layoutClampsWidthPreservesAspectAndCentersTargets() {
    let large = TerminalTabSplitDropLayout(
      bounds: CGRect(x: 0, y: 0, width: 1_200, height: 800)
    )
    #expect(large.leftFrame == CGRect(x: 22, y: 124, width: 345, height: 552))
    #expect(large.rightFrame == CGRect(x: 833, y: 124, width: 345, height: 552))

    let short = TerminalTabSplitDropLayout(
      bounds: CGRect(x: 0, y: 0, width: 760, height: 420)
    )
    #expect(short.leftFrame == CGRect(x: 22, y: 42, width: 210, height: 336))
    #expect(short.rightFrame == CGRect(x: 528, y: 42, width: 210, height: 336))

    let compact = TerminalTabSplitDropLayout(
      bounds: CGRect(x: 0, y: 0, width: 760, height: 420),
      scale: TerminalTabSplitTargetMotion.compactScale
    )
    #expect(compact.leftFrame == CGRect(x: 22, y: 100.5, width: 137, height: 219))
    #expect(compact.rightFrame == CGRect(x: 601, y: 100.5, width: 137, height: 219))
  }

  @Test
  func targetActivationUsesRadialHysteresis() {
    let layout = TerminalTabSplitDropLayout(
      bounds: CGRect(x: 0, y: 0, width: 1_200, height: 800)
    )
    let center = CGPoint(x: layout.leftFrame.midX, y: layout.leftFrame.midY)

    #expect(
      TerminalTabSplitTargetMotion.activeSide(
        at: CGPoint(x: center.x + 90, y: center.y),
        in: layout,
        currentSide: nil
      ) == nil
    )
    #expect(
      TerminalTabSplitTargetMotion.activeSide(
        at: CGPoint(x: center.x + 90, y: center.y),
        in: layout,
        currentSide: .left
      ) == .left
    )
    let boundaryLayout = TerminalTabSplitDropLayout(
      bounds: CGRect(x: -194.5, y: -400, width: 1_200, height: 800)
    )
    let influenceRadius = boundaryLayout.leftFrame.width / 2
    let exitRadius = influenceRadius / 1.7
    #expect(
      TerminalTabSplitTargetMotion.activeSide(
        at: CGPoint(x: exitRadius, y: 0),
        in: boundaryLayout,
        currentSide: .left
      ) == .left
    )
    #expect(
      TerminalTabSplitTargetMotion.activeSide(
        at: CGPoint(x: exitRadius.nextUp, y: 0),
        in: boundaryLayout,
        currentSide: .left
      ) == nil
    )
    #expect(
      TerminalTabSplitTargetMotion.activeSide(
        at: CGPoint(x: influenceRadius / 2, y: 0),
        in: boundaryLayout,
        currentSide: nil
      ) == nil
    )
  }

  @Test
  func targetsMoveTowardThePointerBeforeAndAfterActivation() {
    let layout = TerminalTabSplitDropLayout(
      bounds: CGRect(x: 0, y: 0, width: 1_200, height: 800)
    )
    let point = CGPoint(x: layout.leftFrame.midX + 100, y: layout.leftFrame.midY)
    let attracted = TerminalTabSplitTargetMotion.frame(
      for: .left,
      in: layout,
      point: point,
      activeSide: nil
    )
    let targeted = TerminalTabSplitTargetMotion.frame(
      for: .left,
      in: layout,
      point: point,
      activeSide: .left
    )

    #expect(attracted.midX > layout.leftFrame.midX)
    #expect(attracted.midX < targeted.midX)
    let radius = layout.leftFrame.width / 2 / 1.7
    let expectedOffset = radius * (1 - 1 / (1 + 0.8 * 100 / radius))
    #expect(abs(targeted.midX - layout.leftFrame.midX - expectedOffset) < 0.000_001)
  }

  @Test
  func targetFeedbackOnlyChangesAtStateBoundaries() {
    #expect(
      TerminalTabSplitDropFeedback.transition(from: .hidden, to: .targeted(.left))
        == .entered
    )
    #expect(
      TerminalTabSplitDropFeedback.transition(from: .available, to: .targeted(.left))
        == .entered
    )
    #expect(
      TerminalTabSplitDropFeedback.transition(from: .targeted(.left), to: .targeted(.left))
        == nil
    )
    #expect(
      TerminalTabSplitDropFeedback.transition(from: .targeted(.left), to: .targeted(.right))
        == .entered
    )
    #expect(
      TerminalTabSplitDropFeedback.transition(from: .targeted(.right), to: .available)
        == .exited
    )
    #expect(
      TerminalTabSplitDropFeedback.transition(from: .targeted(.right), to: .hidden)
        == nil
    )
    #expect(TerminalTabSplitDropFeedback.transition(from: .available, to: .hidden) == nil)
    #expect(TerminalTabSplitDropFeedback.transition(from: .hidden, to: .hidden) == nil)
  }

  @Test @MainActor
  func overlayReturnsTargetsBeforeRenderingAndRendersSuppliedPresentation() {
    var feedback: [TerminalTabSplitDropFeedback] = []
    let overlay = TerminalTabSplitDropOverlayView(
      reduceMotion: { true },
      performHaptic: { feedback.append($0) }
    )
    overlay.frame = CGRect(x: 0, y: 0, width: 1_200, height: 800)
    overlay.layoutSubtreeIfNeeded()
    let layout = TerminalTabSplitDropLayout(bounds: overlay.bounds)
    let compactLayout = TerminalTabSplitDropLayout(
      bounds: overlay.bounds,
      scale: TerminalTabSplitTargetMotion.compactScale
    )
    let leftPoint = center(of: compactLayout.leftFrame)
    let rightPoint = center(of: layout.rightFrame)
    let availablePoint = CGPoint(x: overlay.bounds.midX, y: 0)
    let leftHysteresisPoint = CGPoint(
      x: layout.leftFrame.midX + 90,
      y: layout.leftFrame.midY
    )

    #expect(overlay.alphaValue == 0)
    #expect(overlay.target(at: leftPoint) == .left)
    overlay.render(.targeted(.left), at: leftPoint, sharedPreviewReady: true)
    #expect(overlay.alphaValue == 1)
    #expect(feedback == [.entered])
    #expect(overlay.target(at: leftHysteresisPoint) == .left)

    overlay.render(.targeted(.left), at: leftPoint, sharedPreviewReady: true)
    #expect(feedback == [.entered])
    #expect(overlay.target(at: rightPoint) == .right)
    overlay.render(.targeted(.right), at: rightPoint, sharedPreviewReady: true)
    #expect(feedback == [.entered, .entered])
    #expect(overlay.target(at: availablePoint) == nil)
    overlay.render(.available, at: availablePoint, sharedPreviewReady: true)
    #expect(feedback == [.entered, .entered, .exited])
    #expect(overlay.target(at: leftHysteresisPoint) == nil)

    overlay.render(.hidden, at: nil, sharedPreviewReady: false)
    overlay.render(.hidden, at: nil, sharedPreviewReady: false)
    #expect(overlay.alphaValue == 0)
    #expect(feedback == [.entered, .entered, .exited])
  }

  @Test @MainActor
  func firstTargetedPresentationInstallsExplicitLayerAnimations() throws {
    var responses = [0.16, 0.18, 0.24, 0.28].makeIterator()
    let overlay = TerminalTabSplitDropOverlayView(
      reduceMotion: { false },
      nextShowResponse: { responses.next() ?? 0.2 },
      performHaptic: { _ in }
    )
    overlay.frame = CGRect(x: 0, y: 0, width: 1_200, height: 800)
    overlay.layoutSubtreeIfNeeded()
    let layout = TerminalTabSplitDropLayout(bounds: overlay.bounds)
    let compactLayout = TerminalTabSplitDropLayout(
      bounds: overlay.bounds,
      scale: TerminalTabSplitTargetMotion.compactScale
    )
    let point = CGPoint(
      x: compactLayout.leftFrame.midX + 20,
      y: compactLayout.leftFrame.midY
    )
    let target = try #require(overlay.target(at: point))

    overlay.render(.targeted(target), at: point, sharedPreviewReady: true)

    let leftLayer = try #require(overlay.renderedTargetLayer(for: .left))
    let rightLayer = try #require(overlay.renderedTargetLayer(for: .right))
    let animationKeys = [leftLayer, rightLayer].flatMap { $0.animationKeys() ?? [] }
    #expect(animationKeys.contains("splitTargetEntry"))
    #expect(animationKeys.contains("splitTargetPosition"))
    #expect(animationKeys.contains("splitTargetBounds"))
    let leftOpacity = try #require(
      leftLayer.animation(forKey: "splitTargetOpacity") as? CASpringAnimation
    )
    let rightOpacity = try #require(
      rightLayer.animation(forKey: "splitTargetOpacity") as? CASpringAnimation
    )
    let entry = try #require(
      leftLayer.animation(forKey: "splitTargetEntry") as? CASpringAnimation
    )
    let rightEntry = try #require(
      rightLayer.animation(forKey: "splitTargetEntry") as? CASpringAnimation
    )
    let leftContentLayer = try #require(targetContentLayer(in: overlay, side: .left))
    let hover = try #require(
      leftContentLayer.animation(forKey: "splitTargetHover") as? CASpringAnimation
    )
    #expect(abs(entry.stiffness - stiffness(response: 0.16)) < 0.000_001)
    #expect(abs(leftOpacity.stiffness - stiffness(response: 0.18)) < 0.000_001)
    #expect(abs(rightEntry.stiffness - stiffness(response: 0.24)) < 0.000_001)
    #expect(abs(rightOpacity.stiffness - stiffness(response: 0.28)) < 0.000_001)
    #expect(leftOpacity.duration == leftOpacity.settlingDuration)
    #expect(rightOpacity.duration == rightOpacity.settlingDuration)
    #expect(abs(hover.stiffness - stiffness(response: 0.2)) < 0.000_001)
    #expect(abs(hover.damping - damping(response: 0.2, ratio: 0.9)) < 0.000_001)
    #expect(abs(leftContentLayer.transform.m11 - TerminalTabSplitTargetMotion.activeScale) < 0.000_001)
    let nextResponse = responses.next()
    #expect(nextResponse == nil)
    #expect(entry.duration == entry.settlingDuration)
    let expectedFrame = TerminalTabSplitTargetMotion.frame(
      for: .left,
      in: layout,
      point: point,
      activeSide: .left
    )
    #expect(leftLayer.frame == expectedFrame)
  }

  @Test @MainActor
  func targetContentsUseFiniteUnambiguousLayout() {
    let overlay = TerminalTabSplitDropOverlayView(
      reduceMotion: { true },
      performHaptic: { _ in }
    )
    overlay.frame = CGRect(x: 0, y: 0, width: 1_200, height: 800)
    let layout = TerminalTabSplitDropLayout(bounds: overlay.bounds)
    overlay.render(
      .targeted(.left),
      at: center(of: layout.leftFrame),
      sharedPreviewReady: true
    )
    overlay.layoutSubtreeIfNeeded()

    let descendants = descendants(of: overlay)
    #expect(descendants.allSatisfy { isFinite($0.frame) && isFinite($0.bounds) })
    #expect(descendants.allSatisfy { !$0.hasAmbiguousLayout })
  }

  @Test @MainActor
  func hiddenZeroSizeOverlayUsesFiniteNonnegativeGeometry() {
    let overlay = TerminalTabSplitDropOverlayView(
      reduceMotion: { true },
      performHaptic: { _ in }
    )

    overlay.layoutSubtreeIfNeeded()

    let descendants = descendants(of: overlay)
    #expect(descendants.allSatisfy { isFinite($0.frame) && isFinite($0.bounds) })
    #expect(descendants.allSatisfy { $0.frame.width >= 0 && $0.frame.height >= 0 })
    let layout = TerminalTabSplitDropLayout(bounds: overlay.bounds)
    #expect(layout.leftFrame == .zero)
    #expect(layout.rightFrame == .zero)
  }

  @Test @MainActor
  func sharedPreviewReadinessControlsScaleAndDoesNotReplayGeometry() throws {
    let overlay = TerminalTabSplitDropOverlayView(
      reduceMotion: { false },
      nextShowResponse: { 0.2 },
      performHaptic: { _ in }
    )
    overlay.frame = CGRect(x: 0, y: 0, width: 1_200, height: 800)
    overlay.layoutSubtreeIfNeeded()
    let idlePoint = CGPoint(x: overlay.bounds.midX, y: 0)
    let compactLayout = TerminalTabSplitDropLayout(
      bounds: overlay.bounds,
      scale: TerminalTabSplitTargetMotion.compactScale
    )
    let fullLayout = TerminalTabSplitDropLayout(bounds: overlay.bounds)

    overlay.render(.available, at: idlePoint, sharedPreviewReady: false)

    let leftLayer = try #require(overlay.renderedTargetLayer(for: .left))
    let rightLayer = try #require(overlay.renderedTargetLayer(for: .right))
    #expect(leftLayer.frame == compactLayout.leftFrame)
    #expect(rightLayer.frame == compactLayout.rightFrame)
    #expect(leftLayer.animation(forKey: "splitTargetBounds") == nil)
    #expect(
      overlay.target(at: center(of: fullLayout.leftFrame)) == nil
    )
    leftLayer.removeAllAnimations()
    rightLayer.removeAllAnimations()

    overlay.render(.available, at: idlePoint, sharedPreviewReady: true)

    #expect(leftLayer.frame == fullLayout.leftFrame)
    #expect(rightLayer.frame == fullLayout.rightFrame)
    let expand = try #require(
      leftLayer.animation(forKey: "splitTargetBounds") as? CASpringAnimation
    )
    let expandPosition = try #require(
      leftLayer.animation(forKey: "splitTargetPosition") as? CASpringAnimation
    )
    #expect(abs(expand.stiffness - stiffness(response: 0.25)) < 0.000_001)
    #expect(abs(expand.damping - damping(response: 0.25, ratio: 0.82)) < 0.000_001)
    #expect(abs(expandPosition.stiffness - stiffness(response: 0.25)) < 0.000_001)
    #expect(
      abs(expandPosition.damping - damping(response: 0.25, ratio: 0.82)) < 0.000_001
    )
    #expect(
      overlay.target(at: center(of: fullLayout.leftFrame)) == .left
    )
    leftLayer.removeAllAnimations()
    rightLayer.removeAllAnimations()

    let movedPoint = CGPoint(x: fullLayout.leftFrame.midX + 20, y: fullLayout.leftFrame.midY)
    overlay.render(.available, at: movedPoint, sharedPreviewReady: true)

    let pointerPosition = try #require(
      leftLayer.animation(forKey: "splitTargetPosition") as? CASpringAnimation
    )
    #expect(abs(pointerPosition.stiffness - stiffness(response: 0.45)) < 0.000_001)
    #expect(abs(pointerPosition.damping - damping(response: 0.45, ratio: 0.6)) < 0.000_001)
    #expect(leftLayer.animation(forKey: "splitTargetBounds") == nil)
    leftLayer.removeAllAnimations()
    rightLayer.removeAllAnimations()
    overlay.render(.available, at: movedPoint, sharedPreviewReady: true)
    #expect(leftLayer.animationKeys()?.isEmpty != false)
    #expect(rightLayer.animationKeys()?.isEmpty != false)

    overlay.render(.available, at: movedPoint, sharedPreviewReady: false)

    let compactFrame = TerminalTabSplitTargetMotion.frame(
      for: .left,
      in: compactLayout,
      point: movedPoint,
      activeSide: nil
    )
    #expect(leftLayer.frame == compactFrame)
    let contract = try #require(
      leftLayer.animation(forKey: "splitTargetBounds") as? CASpringAnimation
    )
    let contractPosition = try #require(
      leftLayer.animation(forKey: "splitTargetPosition") as? CASpringAnimation
    )
    #expect(abs(contract.stiffness - stiffness(response: 0.25)) < 0.000_001)
    #expect(abs(contract.damping - damping(response: 0.25, ratio: 0.82)) < 0.000_001)
    #expect(abs(contractPosition.stiffness - stiffness(response: 0.25)) < 0.000_001)
    #expect(
      abs(contractPosition.damping - damping(response: 0.25, ratio: 0.82)) < 0.000_001
    )
  }

  @Test @MainActor
  func repeatedPresentationAndExitDoNotReplayFeedbackOrAnimations() throws {
    var feedback: [TerminalTabSplitDropFeedback] = []
    let overlay = TerminalTabSplitDropOverlayView(
      reduceMotion: { false },
      nextShowResponse: { 0.2 },
      performHaptic: { feedback.append($0) }
    )
    overlay.frame = CGRect(x: 0, y: 0, width: 1_200, height: 800)
    overlay.layoutSubtreeIfNeeded()
    let point = center(of: TerminalTabSplitDropLayout(bounds: overlay.bounds).leftFrame)

    overlay.render(.targeted(.left), at: point, sharedPreviewReady: true)
    let leftLayer = try #require(overlay.renderedTargetLayer(for: .left))
    let rightLayer = try #require(overlay.renderedTargetLayer(for: .right))
    leftLayer.removeAllAnimations()
    rightLayer.removeAllAnimations()
    overlay.render(.targeted(.left), at: point, sharedPreviewReady: true)

    #expect(feedback == [.entered])
    #expect(leftLayer.animationKeys()?.isEmpty != false)
    #expect(rightLayer.animationKeys()?.isEmpty != false)

    let leftContentLayer = try #require(targetContentLayer(in: overlay, side: .left))
    leftContentLayer.removeAnimation(forKey: "splitTargetHover")
    overlay.render(.hidden, at: nil, sharedPreviewReady: false)
    #expect(feedback == [.entered])
    let exit = try #require(
      leftLayer.animation(forKey: "splitTargetExit") as? CASpringAnimation
    )
    let opacity = try #require(
      leftLayer.animation(forKey: "splitTargetOpacity") as? CASpringAnimation
    )
    #expect(abs(exit.stiffness - stiffness(response: 0.2)) < 0.000_001)
    #expect(abs(opacity.stiffness - stiffness(response: 0.2)) < 0.000_001)
    #expect(exit.duration == exit.settlingDuration)
    #expect(opacity.duration == opacity.settlingDuration)
    #expect(abs(leftContentLayer.transform.m11 - TerminalTabSplitTargetMotion.activeScale) < 0.000_001)
    #expect(leftContentLayer.animation(forKey: "splitTargetHover") == nil)
    leftLayer.removeAllAnimations()
    rightLayer.removeAllAnimations()
    overlay.render(.hidden, at: nil, sharedPreviewReady: false)
    #expect(leftLayer.animationKeys()?.isEmpty != false)
    #expect(rightLayer.animationKeys()?.isEmpty != false)
  }

  @Test @MainActor
  func reentryBeforeHideCompletionReplaysRootAndHoverEntry() throws {
    var feedback: [TerminalTabSplitDropFeedback] = []
    let overlay = TerminalTabSplitDropOverlayView(
      reduceMotion: { false },
      nextShowResponse: { 0.2 },
      performHaptic: { feedback.append($0) }
    )
    overlay.frame = CGRect(x: 0, y: 0, width: 1_200, height: 800)
    overlay.layoutSubtreeIfNeeded()
    let point = center(of: TerminalTabSplitDropLayout(bounds: overlay.bounds).leftFrame)

    overlay.render(.targeted(.left), at: point, sharedPreviewReady: true)
    overlay.render(.hidden, at: nil, sharedPreviewReady: false)
    overlay.render(.targeted(.left), at: point, sharedPreviewReady: true)

    let leftLayer = try #require(overlay.renderedTargetLayer(for: .left))
    let leftContentLayer = try #require(targetContentLayer(in: overlay, side: .left))
    #expect(leftLayer.animation(forKey: "splitTargetEntry") is CASpringAnimation)
    #expect(leftContentLayer.animation(forKey: "splitTargetHover") is CASpringAnimation)
    #expect(
      abs(leftContentLayer.transform.m11 - TerminalTabSplitTargetMotion.activeScale)
        < 0.000_001
    )
    #expect(feedback == [.entered, .entered])
  }

  private func center(of frame: CGRect) -> CGPoint {
    CGPoint(x: frame.midX, y: frame.midY)
  }

  private func descendants(of view: NSView) -> [NSView] {
    view.subviews + view.subviews.flatMap(descendants)
  }

  private func isFinite(_ rect: CGRect) -> Bool {
    rect.origin.x.isFinite
      && rect.origin.y.isFinite
      && rect.size.width.isFinite
      && rect.size.height.isFinite
  }

  private func targetContentLayer(
    in overlay: TerminalTabSplitDropOverlayView,
    side: TerminalTabSplitSide
  ) -> CALayer? {
    guard
      let targetLayer = overlay.renderedTargetLayer(for: side),
      let targetView = overlay.subviews.first(where: { $0.layer === targetLayer })
    else { return nil }
    return targetView.subviews.first?.layer
  }

  private func stiffness(response: TimeInterval) -> CGFloat {
    let angularFrequency = 2 * CGFloat.pi / response
    return angularFrequency * angularFrequency
  }

  private func damping(response: TimeInterval, ratio: CGFloat) -> CGFloat {
    let angularFrequency = 2 * CGFloat.pi / response
    return 2 * ratio * angularFrequency
  }
}
