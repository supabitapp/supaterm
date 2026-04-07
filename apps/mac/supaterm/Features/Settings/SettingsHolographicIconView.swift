import AppKit
import HoloKit
import SwiftUI

struct SettingsAboutIconRecipe {
  enum LayerKind: Equatable {
    case icon
    case prismBase
    case prismAccent
    case lightSweep
    case glint
  }

  let icon: NSImage
  let showsGlintLayer: Bool
  let showsPrismLayer: Bool

  var layerKinds: [LayerKind] {
    var kinds: [LayerKind] = [
      .icon,
      .prismBase,
    ]
    if showsPrismLayer {
      kinds.append(.prismAccent)
    }
    kinds.append(.lightSweep)
    if showsGlintLayer {
      kinds.append(.glint)
    }
    return kinds
  }

  var layers: [HoloLayer] {
    var layers: [HoloLayer] = [
      .content {
        scaledIcon(icon)
      },
      .prism(.aurora, pattern: .bands)
        .intensity(0.48)
        .scale(1.3)
        .speed(0.4)
        .opacity(0.9)
        .blendMode(.overlay),
    ]

    if showsPrismLayer {
      layers.append(
        .prism(.spectrum, pattern: .ripple)
          .intensity(0.4)
          .scale(1.65)
          .speed(0.62)
          .opacity(0.7)
          .blendMode(.colorDodge)
      )
    }

    layers.append(
      .lightSweep(.white)
        .intensity(0.92)
        .size(0.38)
        .falloff(1.8)
        .opacity(0.95)
        .blendMode(.screen)
    )

    if showsGlintLayer {
      layers.append(
        .glintField()
          .density(0.58)
          .size(1.1)
          .speed(3.2)
          .opacity(0.72)
          .blendMode(.plusLighter)
      )
    }

    return layers
  }

  func mask() -> some View {
    scaledIcon(icon)
  }

  private func scaledIcon(_ image: NSImage) -> some View {
    Image(nsImage: image)
      .resizable()
      .interpolation(.high)
      .scaleEffect(1.12)
      .accessibilityHidden(true)
  }
}

struct SettingsHolographicIconView: View {
  let appName: String
  let showsGlintLayer: Bool
  let showsPrismLayer: Bool

  private let size = CGSize(width: 84, height: 84)
  private let cornerRadius: CGFloat = 21

  var body: some View {
    let icon = NSApplication.shared.applicationIconImage ?? NSImage()
    let recipe = SettingsAboutIconRecipe(
      icon: icon,
      showsGlintLayer: showsGlintLayer,
      showsPrismLayer: showsPrismLayer
    )

    HoloCard(layers: recipe.layers) {
      recipe.mask()
    }
    .holoSize(width: size.width, height: size.height)
    .holoCornerRadius(cornerRadius)
    .holoTilt(7)
    .holoParallax(6)
    .accessibilityLabel("\(appName) app icon")
  }
}
