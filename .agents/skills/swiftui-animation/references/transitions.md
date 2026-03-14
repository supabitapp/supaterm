# SwiftUI Transition Animations

Transition animations handle the appearance and disappearance of views in SwiftUI, allowing smooth cross-fades or movement when views are inserted or removed from the hierarchy.

## Basic Transitions

By default, SwiftUI instantly inserts or removes views. Apply transitions using the `.transition()` modifier on conditional views:

```swift
struct BasicTransitionView: View {
    @State private var showDetails = false

    var body: some View {
        VStack {
            Button("Toggle") {
                withAnimation(.spring()) {
                    showDetails.toggle()
                }
            }

            if showDetails {
                DetailsView()
                    .transition(.opacity)  // Fade in/out
            }
        }
    }
}
```

## Built-in Transitions

### Opacity

```swift
.transition(.opacity)  // Fade in/out
```

### Scale

```swift
.transition(.scale)                    // Scale from center
.transition(.scale(scale: 0.5))        // Scale from 50%
.transition(.scale(scale: 0, anchor: .top))  // Scale from top
```

### Slide

```swift
.transition(.slide)  // Slide in from leading, out to leading
```

### Move

```swift
.transition(.move(edge: .top))      // From/to top
.transition(.move(edge: .bottom))   // From/to bottom
.transition(.move(edge: .leading))  // From/to leading
.transition(.move(edge: .trailing)) // From/to trailing
```

### Push (iOS 17+)

```swift
.transition(.push(from: .bottom))   // Push from bottom
.transition(.push(from: .trailing)) // Push from trailing
```

## Combined Transitions

Combine multiple transitions for richer effects:

```swift
// Slide and fade
.transition(.move(edge: .leading).combined(with: .opacity))

// Scale, rotate, and fade
.transition(
    .scale(scale: 0.5)
    .combined(with: .opacity)
    .combined(with: .rotation3DEffect(.degrees(90), axis: (0, 1, 0)))
)
```

## Asymmetric Transitions

Different animations for insertion vs removal:

```swift
.transition(.asymmetric(
    insertion: .move(edge: .trailing).combined(with: .opacity),
    removal: .move(edge: .leading).combined(with: .opacity)
))

// Card appearing from bottom, disappearing with fade
.transition(.asymmetric(
    insertion: .move(edge: .bottom),
    removal: .opacity
))
```

## Animating Transitions

### With `withAnimation`

```swift
withAnimation(.spring(response: 0.4, dampingFraction: 0.7)) {
    showDetails.toggle()
}
```

### Attached Animation (iOS 17+)

```swift
.transition(.slide.animation(.easeInOut(duration: 0.5)))
```

## Matched Geometry Effect

Creates seamless "hero" animations between two distinct views by interpolating position, size, shape, and other geometric properties.

### Implementation Steps

#### 1. Define a Namespace

```swift
@Namespace var animationNamespace
```

#### 2. Assign Matching IDs

```swift
// Source view
ThumbnailView()
    .matchedGeometryEffect(id: "hero", in: animationNamespace)

// Destination view
FullScreenView()
    .matchedGeometryEffect(id: "hero", in: animationNamespace)
```

#### 3. Toggle Views with Animation

```swift
struct HeroAnimationView: View {
    @Namespace var animationNamespace
    @State private var isExpanded = false

    var body: some View {
        VStack {
            if isExpanded {
                // Expanded state
                RoundedRectangle(cornerRadius: 20)
                    .fill(.blue)
                    .matchedGeometryEffect(id: "card", in: animationNamespace)
                    .frame(width: 300, height: 400)
            } else {
                // Collapsed state
                RoundedRectangle(cornerRadius: 10)
                    .fill(.blue)
                    .matchedGeometryEffect(id: "card", in: animationNamespace)
                    .frame(width: 100, height: 100)
            }
        }
        .onTapGesture {
            withAnimation(.spring(response: 0.4, dampingFraction: 0.75)) {
                isExpanded.toggle()
            }
        }
    }
}
```

### Full Hero Animation Example

```swift
struct CardGridView: View {
    @Namespace var namespace
    @State private var selectedCard: Card?

    var body: some View {
        ZStack {
            // Grid of cards
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 150))]) {
                ForEach(cards) { card in
                    if selectedCard?.id != card.id {
                        CardThumbnail(card: card)
                            .matchedGeometryEffect(id: card.id, in: namespace)
                            .onTapGesture {
                                withAnimation(.spring(response: 0.35, dampingFraction: 0.8)) {
                                    selectedCard = card
                                }
                            }
                    }
                }
            }

            // Expanded card overlay
            if let card = selectedCard {
                CardDetail(card: card)
                    .matchedGeometryEffect(id: card.id, in: namespace)
                    .zIndex(1)
                    .onTapGesture {
                        withAnimation(.spring(response: 0.35, dampingFraction: 0.8)) {
                            selectedCard = nil
                        }
                    }
            }
        }
    }
}

struct CardThumbnail: View {
    let card: Card

    var body: some View {
        VStack {
            Image(card.imageName)
                .resizable()
                .aspectRatio(contentMode: .fill)
            Text(card.title)
                .font(.caption)
        }
        .frame(width: 150, height: 200)
        .background(.ultraThinMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }
}

struct CardDetail: View {
    let card: Card

    var body: some View {
        VStack {
            Image(card.imageName)
                .resizable()
                .aspectRatio(contentMode: .fit)
            Text(card.title)
                .font(.title)
            Text(card.description)
                .font(.body)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(.ultraThinMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 24))
        .padding()
    }
}
```

### Matched Geometry Tips

- Both views must exist in code during the transition (SwiftUI handles visibility)
- Use explicit `withAnimation` for reliable animation triggering
- The interpolation covers position, size, corner radius, and rotation
- For complex views, match individual elements with different IDs
- Use `.zIndex()` to control layering during transitions

## Content Transitions (iOS 17+)

Animate content changes within the same view:

### Numeric Text

```swift
Text("\(count)")
    .contentTransition(.numericText())  // Animated number flip

// With count direction
Text("\(count)")
    .contentTransition(.numericText(countsDown: count < previousCount))
```

### Identity

```swift
Text(currentText)
    .contentTransition(.identity)  // Crossfade between text
```

### Interpolate

```swift
Text(currentText)
    .contentTransition(.interpolate)  // Morph between content
```

## Custom Transitions

Create reusable custom transitions:

```swift
extension AnyTransition {
    static var slideAndFade: AnyTransition {
        .asymmetric(
            insertion: .move(edge: .trailing).combined(with: .opacity),
            removal: .move(edge: .leading).combined(with: .opacity)
        )
    }

    static var popIn: AnyTransition {
        .scale(scale: 0.8)
        .combined(with: .opacity)
        .animation(.spring(response: 0.3, dampingFraction: 0.6))
    }

    static func flyIn(from edge: Edge) -> AnyTransition {
        .asymmetric(
            insertion: .move(edge: edge).combined(with: .opacity),
            removal: .scale(scale: 0.9).combined(with: .opacity)
        )
    }
}

// Usage
SomeView()
    .transition(.slideAndFade)

OtherView()
    .transition(.flyIn(from: .bottom))
```

## View Modifier-Based Custom Transitions

For more complex transitions, use view modifiers:

```swift
struct RotateAndScaleModifier: ViewModifier {
    let amount: Double

    func body(content: Content) -> some View {
        content
            .rotationEffect(.degrees(amount * 360))
            .scaleEffect(1 - amount)
            .opacity(1 - amount)
    }
}

extension AnyTransition {
    static var rotateAway: AnyTransition {
        .modifier(
            active: RotateAndScaleModifier(amount: 1),
            identity: RotateAndScaleModifier(amount: 0)
        )
    }
}
```

## Navigation Transitions (iOS 16+)

Customize navigation transitions:

```swift
NavigationStack {
    ContentView()
        .navigationDestination(for: Item.self) { item in
            DetailView(item: item)
        }
}
.navigationTransition(.slide)  // iOS 18+

// Or using matchedGeometryEffect with NavigationLink
```

## Best Practices

1. **Always wrap state changes in `withAnimation`** for reliable transition animation
2. **Use spring animations** for natural, iOS-native feel
3. **Prefer `.spring(response: 0.35, dampingFraction: 0.8)`** as a starting point
4. **Use asymmetric transitions** when removal should differ from insertion
5. **Combine transitions** for richer visual effects
6. **Leverage matchedGeometryEffect** for hero animations between screens
7. **Test on device** - animations can feel different in simulator

## Sources

- Create with Swift - Matched Geometry Effect in SwiftUI (Feb 2024)
- Apple Developer Documentation - Transitions
- Sebastien Lato, "SwiftUI Animation Masterclass" (Dev.to, 2025)
