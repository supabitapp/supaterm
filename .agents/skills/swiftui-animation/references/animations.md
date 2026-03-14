# SwiftUI Animation APIs

SwiftUI provides a declarative approach to animations, making it easy to animate view changes with minimal code. Animations in SwiftUI can be implicit or explicit.

## Implicit vs Explicit Animations

**Implicit animations** occur when attaching an animation to a view or state change using the `.animation(_:)` modifier.

**Explicit animations** are triggered by wrapping state changes in a `withAnimation` closure. This is the modern, preferred approach as it provides clearer control over what animates.

```swift
// Explicit animation (preferred)
withAnimation {
    isExpanded.toggle()
}

// Implicit animation
SomeView()
    .animation(.spring(), value: isExpanded)
```

When wrapping a state mutation in `withAnimation`, SwiftUI animates any animatable view properties that change by interpolating from their old values to new values over time. SwiftUI automatically computes intermediate frames, producing smooth transitions.

## Basic Animation Curves

SwiftUI includes built-in animation curves and spring dynamics:

### Standard Easing Curves

```swift
withAnimation(.easeInOut) { ... }
withAnimation(.easeIn) { ... }
withAnimation(.easeOut) { ... }
withAnimation(.linear) { ... }
```

### Spring Animations

```swift
// Fully parametric spring
withAnimation(.spring(response: 0.3, dampingFraction: 0.8)) { ... }

// iOS 17+ presets
withAnimation(.smooth) { ... }           // No bounce, gentle transitions
withAnimation(.snappy) { ... }           // Small bounce, modern feel
withAnimation(.bouncy) { ... }           // More bounce

// With custom duration
withAnimation(.snappy(duration: 0.25)) { ... }  // Fast, modern
withAnimation(.smooth(duration: 0.35)) { ... }  // Soft, gentle
```

### Spring Parameters Explained

- **response** - Speed of reaction (lower = faster/stiffer)
- **dampingFraction** - Amount of bounce
  - `0.5` = very bouncy
  - `0.8` = gentle bounce (ideal for interactive drags)
  - `0.9` = nearly critically damped
  - `1.0` = no bounce

```swift
// Quick response with gentle bounce - ideal for pop-ups
withAnimation(.spring(response: 0.3, dampingFraction: 0.8)) {
    showPopup = true
}

// Mimics Apple Music/Wallet feel
withAnimation(.spring(response: 0.4, dampingFraction: 0.7)) {
    cardExpanded = true
}
```

## Animation Modifiers

### Speed and Delay

```swift
withAnimation(.spring().speed(2.0)) { ... }     // 2x speed
withAnimation(.easeInOut.delay(0.5)) { ... }    // 0.5s delay
```

### Repeating Animations

```swift
// Repeat specific count
withAnimation(.easeInOut.repeatCount(3, autoreverses: true)) {
    scale = 1.2
}

// Repeat forever (pulsing effect)
withAnimation(.easeInOut(duration: 1.0).repeatForever(autoreverses: true)) {
    opacity = 0.5
}
```

## Animatable Properties

SwiftUI automatically animates properties conforming to the `Animatable` protocol:

- Frame (size, position)
- Opacity
- Scale
- Rotation
- Offset
- Corner radius
- Colors
- Path shapes

```swift
struct AnimatedCard: View {
    @State private var isExpanded = false

    var body: some View {
        RoundedRectangle(cornerRadius: isExpanded ? 20 : 10)
            .fill(isExpanded ? Color.blue : Color.gray)
            .frame(
                width: isExpanded ? 300 : 150,
                height: isExpanded ? 400 : 200
            )
            .scaleEffect(isExpanded ? 1.0 : 0.9)
            .opacity(isExpanded ? 1.0 : 0.7)
            .onTapGesture {
                withAnimation(.spring(response: 0.4, dampingFraction: 0.7)) {
                    isExpanded.toggle()
                }
            }
    }
}
```

## PhaseAnimator (iOS 17+)

PhaseAnimator creates multi-step animations by defining a sequence of phases:

```swift
enum AnimationPhase: CaseIterable {
    case initial, middle, final
}

struct PhaseAnimatedView: View {
    @State private var trigger = false

    var body: some View {
        PhaseAnimator(AnimationPhase.allCases, trigger: trigger) { phase in
            Circle()
                .fill(.blue)
                .scaleEffect(scaleFor(phase))
                .opacity(opacityFor(phase))
                .rotationEffect(rotationFor(phase))
        } animation: { phase in
            switch phase {
            case .initial: .spring(duration: 0.3)
            case .middle: .easeInOut(duration: 0.5)
            case .final: .bouncy
            }
        }
        .onTapGesture { trigger.toggle() }
    }

    func scaleFor(_ phase: AnimationPhase) -> CGFloat {
        switch phase {
        case .initial: 1.0
        case .middle: 1.5
        case .final: 1.0
        }
    }

    func opacityFor(_ phase: AnimationPhase) -> Double {
        switch phase {
        case .initial: 1.0
        case .middle: 0.5
        case .final: 1.0
        }
    }

    func rotationFor(_ phase: AnimationPhase) -> Angle {
        switch phase {
        case .initial: .zero
        case .middle: .degrees(180)
        case .final: .degrees(360)
        }
    }
}
```

**Use PhaseAnimator when:** Orchestrating a series of distinct visual states where all properties animate together per phase change.

## KeyframeAnimator (iOS 17+)

KeyframeAnimator provides fine-grained control with independent timelines for different properties:

```swift
struct KeyframeValues {
    var scale: Double = 1.0
    var rotation: Angle = .zero
    var verticalOffset: Double = 0.0
}

struct KeyframeAnimatedView: View {
    @State private var trigger = false

    var body: some View {
        KeyframeAnimator(
            initialValue: KeyframeValues(),
            trigger: trigger
        ) { values in
            Circle()
                .fill(.orange)
                .frame(width: 100, height: 100)
                .scaleEffect(values.scale)
                .rotationEffect(values.rotation)
                .offset(y: values.verticalOffset)
        } keyframes: { _ in
            KeyframeTrack(\.scale) {
                LinearKeyframe(1.5, duration: 0.2)
                SpringKeyframe(1.0, duration: 0.3, spring: .bouncy)
            }

            KeyframeTrack(\.rotation) {
                LinearKeyframe(.degrees(180), duration: 0.3)
                CubicKeyframe(.degrees(360), duration: 0.2)
            }

            KeyframeTrack(\.verticalOffset) {
                SpringKeyframe(-50, duration: 0.25, spring: .snappy)
                SpringKeyframe(0, duration: 0.25, spring: .bouncy)
            }
        }
        .onTapGesture { trigger.toggle() }
    }
}
```

### Keyframe Types

- **LinearKeyframe** - Constant velocity interpolation
- **SpringKeyframe** - Spring-based timing
- **CubicKeyframe** - Cubic Bezier curve
- **MoveKeyframe** - Instantaneous jump (no interpolation)

**Use KeyframeAnimator when:** Different properties need to animate on their own independent timelines for rich, orchestrated effects.

## Custom Animatable Properties

Create custom animatable types by conforming to `Animatable`:

```swift
struct AnimatableProgress: Shape {
    var progress: Double

    var animatableData: Double {
        get { progress }
        set { progress = newValue }
    }

    func path(in rect: CGRect) -> Path {
        var path = Path()
        let width = rect.width * progress
        path.addRect(CGRect(x: 0, y: 0, width: width, height: rect.height))
        return path
    }
}

// Usage
struct ProgressView: View {
    @State private var progress: Double = 0

    var body: some View {
        AnimatableProgress(progress: progress)
            .fill(.blue)
            .frame(height: 20)
            .onAppear {
                withAnimation(.easeInOut(duration: 2.0)) {
                    progress = 1.0
                }
            }
    }
}
```

## Sources

- Apple WWDC23 Session - Explore SwiftUI Animation
- Apple Developer Documentation - Animation
- Sebastien Lato, "SwiftUI Animation Masterclass" (Dev.to, 2025)
- AppCoda - Using PhaseAnimator (Aug 2023)
- AppCoda - Creating Advanced Animations with KeyframeAnimator (Aug 2023)
