import AppKit
import SwiftUI

public struct BlurEffectView: NSViewRepresentable {
  public let material: NSVisualEffectView.Material
  public let blendingMode: NSVisualEffectView.BlendingMode

  public init(material: NSVisualEffectView.Material, blendingMode: NSVisualEffectView.BlendingMode) {
    self.material = material
    self.blendingMode = blendingMode
  }

  public func makeNSView(context: Context) -> NSVisualEffectView {
    let visualEffectView = NSVisualEffectView()
    visualEffectView.material = material
    visualEffectView.blendingMode = blendingMode
    visualEffectView.state = .active
    return visualEffectView
  }

  public func updateNSView(_ nsView: NSVisualEffectView, context: Context) {
    nsView.material = material
    nsView.blendingMode = blendingMode
    nsView.state = .active
  }
}
