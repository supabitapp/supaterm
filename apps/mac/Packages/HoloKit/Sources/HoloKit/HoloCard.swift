import SwiftUI

public struct HoloCard: View {
  @Environment(\.holoCardSize) private var cardSize
  @Environment(\.holoCardCornerRadius) private var cornerRadius
  @Environment(\.holoCardTiltDegrees) private var tiltDegrees
  @Environment(\.holoCardParallaxDistance) private var parallaxDistance
  @Environment(\.holoMotionSource) private var motionSource
  @Environment(\.accessibilityReduceMotion) private var accessibilityReduceMotion

  private let layers: [HoloLayer]
  private let maskView: AnyView?

  @State private var interactionState = HoloInteractionState.resting
  @State private var startDate = Date()

  public init(layers: [HoloLayer]) {
    self.layers = layers
    self.maskView = nil
  }

  public init<Mask: View>(
    layers: [HoloLayer],
    @ViewBuilder mask: () -> Mask
  ) {
    self.layers = layers
    self.maskView = AnyView(mask())
  }

  public init(@HoloLayerBuilder _ content: () -> [HoloLayer]) {
    self.layers = content()
    self.maskView = nil
  }

  public var body: some View {
    TimelineView(.animation(paused: animationPaused)) { context in
      let tilt = currentTilt
      let time = animationPaused ? 0 : Float(context.date.timeIntervalSince(startDate))
      let renderedLayers = ZStack {
        ForEach(layers) { layer in
          renderer.render(layer: layer, tilt: tilt, time: time)
            .offset(parallaxOffset(for: layer, tilt: tilt))
        }
      }
      .frame(width: cardSize.width, height: cardSize.height)

      interactiveSurface(
        maskedSurface(renderedLayers)
          .rotation3DEffect(
            .degrees(accessibilityReduceMotion ? 0 : Double(tilt.pitch) * tiltDegrees),
            axis: (x: 1, y: 0, z: 0),
            perspective: 0.7
          )
          .rotation3DEffect(
            .degrees(accessibilityReduceMotion ? 0 : -Double(tilt.roll) * tiltDegrees),
            axis: (x: 0, y: 1, z: 0),
            perspective: 0.7
          )
          .shadow(
            color: .black.opacity(interactionState.isActive ? 0.28 : 0.18),
            radius: interactionState.isActive ? 12 : 8,
            y: interactionState.isActive ? 9 : 6
          )
          .contentShape(.rect(cornerRadius: cornerRadius))
      )
    }
  }

  private var renderer: HoloLayerRenderer {
    HoloLayerRenderer(
      cardSize: cardSize,
      cornerRadius: cornerRadius,
      parallaxDistance: parallaxDistance
    )
  }

  private var animationPaused: Bool {
    accessibilityReduceMotion || !motionSource.usesPointerInput
  }

  private var currentTilt: HoloTilt {
    let tilt = motionSource.tilt(using: interactionState)
    if accessibilityReduceMotion {
      return .zero
    }
    return tilt
  }

  private func parallaxOffset(for layer: HoloLayer, tilt: HoloTilt) -> CGSize {
    CGSize(
      width: CGFloat(tilt.roll) * parallaxDistance * layer.parallaxFactor,
      height: CGFloat(-tilt.pitch) * parallaxDistance * layer.parallaxFactor
    )
  }

  @ViewBuilder
  private func maskedSurface<Content: View>(_ content: Content) -> some View {
    if let maskView {
      content.mask(maskView)
    } else {
      content
    }
  }

  @ViewBuilder
  private func interactiveSurface<Content: View>(_ content: Content) -> some View {
    if motionSource.usesPointerInput {
      content
        .onContinuousHover(coordinateSpace: .local) { phase in
          updateInteractionState(phase)
        }
        .gesture(
          DragGesture(minimumDistance: 0)
            .onChanged { value in
              interactionState = .active(location: value.location, in: cardSize)
            }
            .onEnded { _ in
              endInteraction()
            }
        )
    } else {
      content
    }
  }

  private func updateInteractionState(_ phase: HoverPhase) {
    switch phase {
    case .active(let location):
      interactionState = .active(location: location, in: cardSize)
    case .ended:
      endInteraction()
    }
  }

  private func endInteraction() {
    if accessibilityReduceMotion {
      interactionState = .resting
    } else {
      withAnimation(.smooth(duration: 0.18)) {
        interactionState = .resting
      }
    }
  }
}
