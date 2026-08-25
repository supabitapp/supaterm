import AppKit
import SwiftUI
import UniformTypeIdentifiers

struct TerminalNotificationPulseSegment: Equatable {
  let delay: TimeInterval
  let duration: TimeInterval
  let targetOpacity: Double
}

enum TerminalNotificationPulsePattern {
  static let initialOpacity = 1.0
  static let lowOpacity = 0.32
  static let totalDuration: TimeInterval = 1.0
  static let targetOpacities: [Double] = [
    lowOpacity,
    initialOpacity,
    lowOpacity,
    initialOpacity,
    lowOpacity,
    initialOpacity,
    0,
  ]

  static var stepDuration: TimeInterval {
    totalDuration / Double(targetOpacities.count)
  }

  static var segments: [TerminalNotificationPulseSegment] {
    targetOpacities.enumerated().map { index, targetOpacity in
      TerminalNotificationPulseSegment(
        delay: Double(index) * stepDuration,
        duration: stepDuration,
        targetOpacity: targetOpacity
      )
    }
  }
}

extension TerminalSplitTreeView {
  enum OuterEdgeBranch {
    case left
    case right
  }

  struct OuterEdges: OptionSet, Equatable {
    let rawValue: Int

    static let top = Self(rawValue: 1 << 0)
    static let bottom = Self(rawValue: 1 << 1)
    static let leading = Self(rawValue: 1 << 2)
    static let trailing = Self(rawValue: 1 << 3)
    static let all: Self = [.top, .bottom, .leading, .trailing]

    func child(_ branch: OuterEdgeBranch, in direction: SplitTree<GhosttySurfaceView>.Direction) -> Self {
      switch (direction, branch) {
      case (.horizontal, .left):
        removing(.trailing)
      case (.horizontal, .right):
        removing(.leading)
      case (.vertical, .left):
        removing(.bottom)
      case (.vertical, .right):
        removing(.top)
      }
    }

    func paneInsets(outer: CGFloat, inner: CGFloat) -> EdgeInsets {
      EdgeInsets(
        top: contains(.top) ? outer : inner,
        leading: contains(.leading) ? outer : inner,
        bottom: contains(.bottom) ? outer : inner,
        trailing: contains(.trailing) ? outer : inner
      )
    }

    private func removing(_ edges: Self) -> Self {
      TerminalSplitTreeView.OuterEdges(rawValue: rawValue & ~edges.rawValue)
    }
  }

  struct PaneChromeConfiguration {
    let isSidebarCollapsed: Bool
    let showsSidebarAttentionIndicator: Bool
    let tree: SplitTree<GhosttySurfaceView>

    var canEqualize: Bool { tree.isSplit }
    var sidebarPaneID: UUID? { (tree.zoomed ?? tree.root)?.leftmostLeaf().id }
    var zoomedPaneID: UUID? { tree.zoomed?.leftmostLeaf().id }
  }

  static let dragType = UTType(exportedAs: "sh.supacode.ghosttySurfaceId")
  static func dragProvider(for surfaceView: GhosttySurfaceView) -> NSItemProvider {
    let provider = NSItemProvider()
    let data = surfaceView.id.uuidString.data(using: .utf8) ?? Data()
    provider.registerDataRepresentation(
      forTypeIdentifier: dragType.identifier,
      visibility: .all
    ) { completion in
      completion(data, nil)
      return nil
    }
    return provider
  }

  enum DropState: Equatable {
    case idle
    case dropping(TerminalSplitDropZone)
  }

  struct SplitDropDelegate: DropDelegate {
    @Binding var dropState: DropState
    let viewSize: CGSize
    let destinationId: UUID
    let action: (Operation) -> Void

    func validateDrop(info: DropInfo) -> Bool {
      info.hasItemsConforming(to: [TerminalSplitTreeView.dragType])
    }

    func dropEntered(info: DropInfo) {
      dropState = .dropping(.calculate(at: info.location, in: viewSize))
    }

    func dropUpdated(info: DropInfo) -> DropProposal? {
      guard case .dropping = dropState else { return DropProposal(operation: .forbidden) }
      dropState = .dropping(.calculate(at: info.location, in: viewSize))
      return DropProposal(operation: .move)
    }

    func dropExited(info: DropInfo) {
      dropState = .idle
    }

    func performDrop(info: DropInfo) -> Bool {
      let zone = TerminalSplitDropZone.calculate(at: info.location, in: viewSize)
      dropState = .idle

      let providers = info.itemProviders(for: [TerminalSplitTreeView.dragType])
      guard let provider = providers.first else { return false }
      provider.loadDataRepresentation(
        forTypeIdentifier: TerminalSplitTreeView.dragType.identifier
      ) { data, _ in
        guard let data,
          let raw = String(data: data, encoding: .utf8),
          let payloadId = UUID(uuidString: raw)
        else { return }
        Task { @MainActor in
          action(
            .mutateTree(
              .drop(
                payloadId: payloadId,
                destinationId: destinationId,
                zone: zone
              )))
        }
      }
      return true
    }
  }
}
