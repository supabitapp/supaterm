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
        .intensity(0.28)
        .scale(1.24)
        .speed(0.36)
        .opacity(0.62)
        .blendMode(.overlay),
    ]

    if showsPrismLayer {
      layers.append(
        .prism(.spectrum, pattern: .ripple)
          .intensity(0.34)
          .scale(1.52)
          .speed(0.56)
          .opacity(0.46)
          .blendMode(.overlay)
      )
    }

    layers.append(
      .lightSweep(.white)
        .intensity(0.8)
        .size(0.34)
        .falloff(1.6)
        .opacity(0.82)
        .blendMode(.screen)
    )

    if showsGlintLayer {
      layers.append(
        .glintField()
          .density(0.52)
          .size(0.96)
          .speed(2.8)
          .opacity(0.56)
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
