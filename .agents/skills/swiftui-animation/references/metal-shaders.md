# Metal Shaders and SwiftUI Integration

Metal is Apple's low-level graphics and compute shader framework for GPU-accelerated rendering and effects. It can be combined with SwiftUI in two primary ways:

1. **SwiftUI shader effects** - Built-in modifiers for per-view GPU processing (iOS 17+)
2. **Custom Metal rendering** - Embedding MTKView for fully custom pipelines

Both approaches work cross-platform (iOS, macOS, visionOS) with similar APIs.

## SwiftUI Shader Effects (iOS 17+)

Modern SwiftUI introduces view modifiers that apply custom Metal fragment shaders directly to views:

- `.colorEffect()` - Modify pixel colors only
- `.distortionEffect()` - Displace pixel positions (warping, ripples)
- `.layerEffect()` - Full composite effects with original layer access

### How Shaders Work in SwiftUI

Shaders are small programs that run on your device's GPU. SwiftUI uses shaders internally to implement many visual effects like Mesh Gradients. When you apply a shader effect to a view using modifiers like `.layerEffect()`, SwiftUI calls your shader function for every single pixel of your view.

```swift
// Instantiate a shader from ShaderLibrary
let shader = ShaderLibrary.ripple(
    .float(time),
    .float2(origin),
    .color(.pink)
)

// Apply to a view
myView.layerEffect(shader, maxSampleOffset: CGSize(width: 100, height: 100))
```

### Metal Shading Language Basics

Shaders are written in Metal Shading Language (not Swift). The shader function name matches the invocation on `ShaderLibrary`.

```metal
// Shaders.metal
#include <metal_stdlib>
#include <SwiftUI/SwiftUI_Metal.h>
using namespace metal;

[[stitchable]] half4 myEffect(
    float2 position,      // Current pixel's location
    SwiftUI::Layer layer, // View's content (for sampling)
    half4 color           // SwiftUI Color converted to half4
) {
    // position: the pixel being processed
    // layer.sample(pos): get color at position (must stay within maxSampleOffset)
    // color: passed-in color parameter

    return layer.sample(position);
}
```

### Metal Vector Types

Metal uses vector types extensively:

- `float2` - Two-component 32-bit float (2D points, dimensions)
- `half4` - Four-component 16-bit float (RGBA colors)
- `float3` - Three-component 32-bit float (RGB, 3D positions)
- `float4` - Four-component 32-bit float

SwiftUI automatically converts types like `Color` to Metal representations (`half4`).

### Creating a Metal Shader

#### 1. Add a Metal File

Create a `.metal` file in your project:

```metal
// Shaders.metal
#include <metal_stdlib>
#include <SwiftUI/SwiftUI_Metal.h>
using namespace metal;

// Color effect - modify colors only
[[stitchable]] half4 pixelate(
    float2 position,
    SwiftUI::Layer layer,
    float size
) {
    float2 pixelatedPosition = floor(position / size) * size;
    return layer.sample(pixelatedPosition);
}

// Distortion effect - displace pixels
[[stitchable]] float2 wave(
    float2 position,
    float time,
    float amplitude,
    float frequency
) {
    float2 offset = float2(
        sin(position.y * frequency + time) * amplitude,
        cos(position.x * frequency + time) * amplitude
    );
    return position + offset;
}

// Color manipulation
[[stitchable]] half4 colorShift(
    float2 position,
    half4 color,
    float hueShift
) {
    // Convert RGB to HSV, shift hue, convert back
    float3 rgb = float3(color.rgb);
    // ... HSV conversion logic ...
    return half4(rgb.r, rgb.g, rgb.b, color.a);
}
```

#### 2. Apply in SwiftUI

```swift
import SwiftUI

struct ShaderDemoView: View {
    var body: some View {
        Image("photo")
            .resizable()
            .aspectRatio(contentMode: .fit)
            .layerEffect(
                ShaderLibrary.pixelate(.float(10)),
                maxSampleOffset: .zero
            )
    }
}

struct WaveEffectView: View {
    @State private var time: Float = 0

    var body: some View {
        Text("Wavy Text")
            .font(.largeTitle)
            .distortionEffect(
                ShaderLibrary.wave(
                    .float(time),
                    .float(5),    // amplitude
                    .float(0.1)   // frequency
                ),
                maxSampleOffset: CGSize(width: 10, height: 10)
            )
            .onReceive(Timer.publish(every: 1/60, on: .main, in: .common).autoconnect()) { _ in
                time += 0.05
            }
    }
}
```

### Shader Types Explained

#### colorEffect

Changes pixel colors without moving them. The shader receives the current color and position.

```swift
.colorEffect(ShaderLibrary.invertColors())
```

```metal
[[stitchable]] half4 invertColors(float2 position, half4 color) {
    return half4(1.0 - color.rgb, color.a);
}
```

#### distortionEffect

Displaces pixels to new positions. Returns the source position to sample from.

```swift
.distortionEffect(
    ShaderLibrary.ripple(.float(time), .float2(center)),
    maxSampleOffset: CGSize(width: 100, height: 100)
)
```

```metal
[[stitchable]] float2 ripple(
    float2 position,
    float time,
    float2 center
) {
    float distance = length(position - center);
    float wave = sin(distance * 0.1 - time * 5) * 10;
    float2 direction = normalize(position - center);
    return position + direction * wave;
}
```

**Important:** Set `maxSampleOffset` to the maximum distance pixels can move.

#### layerEffect

Full access to the rendered layer, enabling complex composite effects. This is the most powerful effect type and effectively a superset of the other two.

```swift
.layerEffect(
    ShaderLibrary.blur(.float(radius)),
    maxSampleOffset: CGSize(width: radius, height: radius)
)
```

```metal
[[stitchable]] half4 blur(
    float2 position,
    SwiftUI::Layer layer,
    float radius
) {
    half4 color = half4(0);
    float samples = 0;

    for (float x = -radius; x <= radius; x += 1) {
        for (float y = -radius; y <= radius; y += 1) {
            color += layer.sample(position + float2(x, y));
            samples += 1;
        }
    }

    return color / samples;
}
```

## Complete Ripple Effect Example (WWDC 2024)

This example from WWDC 2024 shows a touch-responsive ripple effect that spreads from the touch location.

### Metal Shader

```metal
[[stitchable]] half4 ripple(
    float2 position,
    SwiftUI::Layer layer,
    float2 origin,
    float time,
    float amplitude,
    float frequency,
    float decay,
    float speed
) {
    // Calculate distance from touch origin
    float distance = length(position - origin);

    // Calculate ripple displacement
    float rippleAmount = amplitude * sin(frequency * distance - speed * time);
    rippleAmount *= exp(-decay * distance); // Decay with distance

    // Calculate new sample position
    float2 direction = normalize(position - origin);
    float2 newPosition = position + direction * rippleAmount;

    // Sample the layer at the distorted position
    half4 color = layer.sample(newPosition);

    // Optional: adjust brightness based on distortion strength
    float brightness = 1.0 + rippleAmount * 0.02;
    color.rgb *= brightness;

    return color;
}
```

### SwiftUI ViewModifier

```swift
struct RippleModifier: ViewModifier {
    var origin: CGPoint
    var elapsedTime: TimeInterval
    var amplitude: Double = 12
    var frequency: Double = 15
    var decay: Double = 8
    var speed: Double = 1200

    func body(content: Content) -> some View {
        content.layerEffect(
            ShaderLibrary.ripple(
                .float2(origin),
                .float(elapsedTime),
                .float(amplitude),
                .float(frequency),
                .float(decay),
                .float(speed)
            ),
            maxSampleOffset: CGSize(width: 100, height: 100)
        )
    }
}
```

### Animated Ripple Effect

```swift
struct RippleEffect: ViewModifier {
    var origin: CGPoint
    var trigger: Bool
    var duration: TimeInterval = 1.5

    func body(content: Content) -> some View {
        content.keyframeAnimator(
            initialValue: 0.0,
            trigger: trigger
        ) { view, elapsedTime in
            view.modifier(RippleModifier(
                origin: origin,
                elapsedTime: elapsedTime
            ))
        } keyframes: { _ in
            LinearKeyframe(duration, duration: duration)
        }
    }
}

extension View {
    func rippleEffect(at origin: CGPoint, trigger: Bool) -> some View {
        modifier(RippleEffect(origin: origin, trigger: trigger))
    }
}

// Usage
struct RippleDemo: View {
    @State private var tapLocation: CGPoint = .zero
    @State private var trigger = false

    var body: some View {
        Image("photo")
            .resizable()
            .aspectRatio(contentMode: .fit)
            .rippleEffect(at: tapLocation, trigger: trigger)
            .onTapGesture { location in
                tapLocation = location
                trigger.toggle()
            }
    }
}
```

### Debug UI for Shader Parameters

Building great shader effects requires experimentation. Create debug UI to iterate quickly:

```swift
struct ShaderDebugView: View {
    @State private var amplitude: Double = 12
    @State private var frequency: Double = 15
    @State private var decay: Double = 8
    @State private var speed: Double = 1200
    @State private var time: Double = 0

    var body: some View {
        VStack {
            // Preview with scrubber
            Image("photo")
                .resizable()
                .aspectRatio(contentMode: .fit)
                .modifier(RippleModifier(
                    origin: CGPoint(x: 150, y: 150),
                    elapsedTime: time,
                    amplitude: amplitude,
                    frequency: frequency,
                    decay: decay,
                    speed: speed
                ))

            // Time scrubber
            Slider(value: $time, in: 0...2)
            Text("Time: \(time, specifier: "%.2f")")

            // Parameter controls
            Group {
                Slider(value: $amplitude, in: 0...50)
                Text("Amplitude: \(amplitude, specifier: "%.1f")")

                Slider(value: $frequency, in: 0...50)
                Text("Frequency: \(frequency, specifier: "%.1f")")

                Slider(value: $decay, in: 0...20)
                Text("Decay: \(decay, specifier: "%.1f")")

                Slider(value: $speed, in: 0...3000)
                Text("Speed: \(speed, specifier: "%.0f")")
            }
        }
        .padding()
    }
}
```

## Scroll Effects with visualEffect

The `visualEffect` modifier provides access to view geometry for position-based effects:

```swift
struct GroceryListView: View {
    let items: [GroceryItem]

    var body: some View {
        ScrollView {
            ForEach(items) { item in
                ItemRow(item: item)
                    .visualEffect { content, proxy in
                        let frame = proxy.frame(in: .scrollView)
                        let yPosition = frame.minY

                        return content
                            .hueRotation(.degrees(yPosition / 3))
                            .offset(y: yPosition < 100 ? (100 - yPosition) * 0.3 : 0)
                            .scaleEffect(yPosition < 100 ? 0.9 + (yPosition / 1000) : 1)
                            .blur(radius: yPosition < 50 ? (50 - yPosition) / 10 : 0)
                            .opacity(yPosition < 50 ? yPosition / 50 : 1)
                    }
            }
        }
    }
}
```

## Mesh Gradients (iOS 18+)

Mesh gradients create beautiful color fills from a grid of control points:

```swift
struct MeshGradientView: View {
    var body: some View {
        MeshGradient(
            width: 3,
            height: 3,
            points: [
                // Row 0
                SIMD2(0.0, 0.0), SIMD2(0.5, 0.0), SIMD2(1.0, 0.0),
                // Row 1
                SIMD2(0.0, 0.5), SIMD2(0.5, 0.5), SIMD2(1.0, 0.5),
                // Row 2
                SIMD2(0.0, 1.0), SIMD2(0.5, 1.0), SIMD2(1.0, 1.0)
            ],
            colors: [
                .red, .orange, .yellow,
                .green, .blue, .purple,
                .pink, .mint, .cyan
            ]
        )
        .ignoresSafeArea()
    }
}
```

### Animated Mesh Gradient

```swift
struct AnimatedMeshGradient: View {
    @State private var centerPoint = SIMD2<Float>(0.5, 0.5)

    var body: some View {
        TimelineView(.animation) { timeline in
            let time = timeline.date.timeIntervalSinceReferenceDate

            MeshGradient(
                width: 3,
                height: 3,
                points: [
                    SIMD2(0.0, 0.0), SIMD2(0.5, 0.0), SIMD2(1.0, 0.0),
                    SIMD2(0.0, 0.5),
                    SIMD2(
                        0.5 + Float(sin(time)) * 0.2,
                        0.5 + Float(cos(time)) * 0.2
                    ),
                    SIMD2(1.0, 0.5),
                    SIMD2(0.0, 1.0), SIMD2(0.5, 1.0), SIMD2(1.0, 1.0)
                ],
                colors: [
                    .red, .orange, .yellow,
                    .green, .blue, .purple,
                    .pink, .mint, .cyan
                ]
            )
        }
    }
}
```

## TextRenderer (iOS 18+)

TextRenderer allows customizing how SwiftUI Text is drawn, enabling per-glyph animations.

### Basic TextRenderer

```swift
struct AnimatedTextRenderer: TextRenderer {
    var elapsedTime: TimeInterval
    var elementDuration: TimeInterval = 0.1
    var totalDuration: TimeInterval = 0.9

    var animatableData: Double {
        get { elapsedTime }
        set { elapsedTime = newValue }
    }

    func draw(layout: Text.Layout, in context: inout GraphicsContext) {
        let count = layout.flattenedRunSlices.count
        let delay = elementDelay(count: count)

        for (index, slice) in layout.flattenedRunSlices.enumerated() {
            let timeOffset = Double(index) * delay
            let elementTime = max(0, min(elementDuration, elapsedTime - timeOffset))
            let progress = elementTime / elementDuration

            var copy = context

            // Animate opacity
            copy.opacity = progress

            // Animate blur (from blurry to sharp)
            let blurRadius = (1 - progress) * slice.typographicBounds.height / 3
            copy.addFilter(.blur(radius: blurRadius))

            // Animate vertical position
            let yOffset = (1 - progress) * -slice.typographicBounds.descent
            copy.translateBy(x: 0, y: yOffset)

            copy.draw(slice, options: .disablesSubpixelQuantization)
        }
    }

    private func elementDelay(count: Int) -> Double {
        (totalDuration - elementDuration) / Double(max(1, count - 1))
    }
}
```

### Using TextRenderer with Transitions

```swift
struct TextAppearTransition: Transition {
    func body(content: Content, phase: TransitionPhase) -> some View {
        content
            .transaction { transaction in
                if !transaction.animation?.isSpring ?? false {
                    transaction.animation = .linear(duration: 0.9)
                }
            }
            .textRenderer(AnimatedTextRenderer(
                elapsedTime: phase.isIdentity ? 0.9 : 0
            ))
    }
}

extension AnyTransition {
    static var textAppear: AnyTransition {
        .modifier(
            active: TextAppearTransition(),
            identity: TextAppearTransition()
        )
    }
}

// Usage
struct TextTransitionDemo: View {
    @State private var showText = false

    var body: some View {
        VStack {
            if showText {
                Text("Visual Effects")
                    .font(.largeTitle)
                    .transition(.textAppear)
            }

            Button("Toggle") {
                withAnimation {
                    showText.toggle()
                }
            }
        }
    }
}
```

### TextAttribute for Selective Animation

Mark specific text ranges for special treatment:

```swift
struct EmphasisAttribute: TextAttribute {}

extension Text {
    func emphasis() -> Text {
        self.customAttribute(EmphasisAttribute())
    }
}

// Usage
Text("Welcome to ") + Text("Visual Effects").emphasis() + Text("!")
```

Then in your TextRenderer, check for the attribute:

```swift
func draw(layout: Text.Layout, in context: inout GraphicsContext) {
    for run in layout.flattenedRuns {
        let hasEmphasis = run[EmphasisAttribute.self] != nil

        if hasEmphasis {
            // Animate per-glyph
            for slice in run {
                // ... glyph animation
            }
        } else {
            // Simple fade
            context.opacity = progress
            context.draw(run)
        }
    }
}
```

## Animated Shader Example

```swift
struct AnimatedShaderView: View {
    var body: some View {
        TimelineView(.animation) { timeline in
            let time = timeline.date.timeIntervalSinceReferenceDate

            Image("background")
                .resizable()
                .aspectRatio(contentMode: .fill)
                .distortionEffect(
                    ShaderLibrary.wave(
                        .float(Float(time)),
                        .float(8),
                        .float(0.05)
                    ),
                    maxSampleOffset: CGSize(width: 20, height: 20)
                )
        }
    }
}
```

## Common Shader Effects

### Chromatic Aberration

```metal
[[stitchable]] half4 chromaticAberration(
    float2 position,
    SwiftUI::Layer layer,
    float amount
) {
    half4 r = layer.sample(position + float2(amount, 0));
    half4 g = layer.sample(position);
    half4 b = layer.sample(position - float2(amount, 0));
    return half4(r.r, g.g, b.b, g.a);
}
```

### Vignette

```metal
[[stitchable]] half4 vignette(
    float2 position,
    half4 color,
    float2 size,
    float intensity
) {
    float2 uv = position / size;
    float2 center = float2(0.5, 0.5);
    float dist = distance(uv, center);
    float vignette = 1.0 - smoothstep(0.3, 0.7, dist * intensity);
    return half4(color.rgb * vignette, color.a);
}
```

### Noise/Grain

```metal
[[stitchable]] half4 filmGrain(
    float2 position,
    half4 color,
    float time,
    float intensity
) {
    float noise = fract(sin(dot(position + time, float2(12.9898, 78.233))) * 43758.5453);
    half3 grain = half3(noise * intensity);
    return half4(color.rgb + grain, color.a);
}
```

### Gradient Map

```metal
[[stitchable]] half4 gradientMap(
    float2 position,
    SwiftUI::Layer layer,
    half4 shadowColor,
    half4 highlightColor
) {
    half4 original = layer.sample(position);
    float luminance = dot(original.rgb, half3(0.299, 0.587, 0.114));
    half3 mapped = mix(shadowColor.rgb, highlightColor.rgb, luminance);
    return half4(mapped, original.a);
}
```

## Embedding Metal with UIViewRepresentable

For full control over Metal rendering (3D content, custom vertex shaders, multi-pass rendering), embed an MTKView in SwiftUI.

### Basic Setup

```swift
import SwiftUI
import MetalKit

struct MetalView: UIViewRepresentable {
    func makeCoordinator() -> Renderer {
        Renderer()
    }

    func makeUIView(context: Context) -> MTKView {
        let mtkView = MTKView()
        mtkView.device = MTLCreateSystemDefaultDevice()
        mtkView.delegate = context.coordinator
        mtkView.preferredFramesPerSecond = 60
        mtkView.enableSetNeedsDisplay = false
        mtkView.isPaused = false
        mtkView.clearColor = MTLClearColor(red: 0, green: 0, blue: 0, alpha: 1)
        context.coordinator.setup(mtkView: mtkView)
        return mtkView
    }

    func updateUIView(_ uiView: MTKView, context: Context) {}
}

class Renderer: NSObject, MTKViewDelegate {
    var device: MTLDevice!
    var commandQueue: MTLCommandQueue!
    var pipelineState: MTLRenderPipelineState!

    func setup(mtkView: MTKView) {
        device = mtkView.device
        commandQueue = device.makeCommandQueue()

        let library = device.makeDefaultLibrary()!
        let vertexFunction = library.makeFunction(name: "vertexShader")
        let fragmentFunction = library.makeFunction(name: "fragmentShader")

        let pipelineDescriptor = MTLRenderPipelineDescriptor()
        pipelineDescriptor.vertexFunction = vertexFunction
        pipelineDescriptor.fragmentFunction = fragmentFunction
        pipelineDescriptor.colorAttachments[0].pixelFormat = mtkView.colorPixelFormat

        pipelineState = try! device.makeRenderPipelineState(descriptor: pipelineDescriptor)
    }

    func mtkView(_ view: MTKView, drawableSizeWillChange size: CGSize) {}

    func draw(in view: MTKView) {
        guard let drawable = view.currentDrawable,
              let renderPassDescriptor = view.currentRenderPassDescriptor,
              let commandBuffer = commandQueue.makeCommandBuffer(),
              let renderEncoder = commandBuffer.makeRenderCommandEncoder(descriptor: renderPassDescriptor)
        else { return }

        renderEncoder.setRenderPipelineState(pipelineState)
        renderEncoder.endEncoding()

        commandBuffer.present(drawable)
        commandBuffer.commit()
    }
}
```

### Cross-Platform Version

```swift
import SwiftUI
import MetalKit

#if os(iOS) || os(tvOS)
typealias ViewRepresentable = UIViewRepresentable
#elseif os(macOS)
typealias ViewRepresentable = NSViewRepresentable
#endif

struct MetalView: ViewRepresentable {
    func makeCoordinator() -> Renderer { Renderer() }

    #if os(iOS) || os(tvOS)
    func makeUIView(context: Context) -> MTKView { createMTKView(context: context) }
    func updateUIView(_ uiView: MTKView, context: Context) {}
    #elseif os(macOS)
    func makeNSView(context: Context) -> MTKView { createMTKView(context: context) }
    func updateNSView(_ nsView: MTKView, context: Context) {}
    #endif

    private func createMTKView(context: Context) -> MTKView {
        let mtkView = MTKView()
        mtkView.device = MTLCreateSystemDefaultDevice()
        mtkView.delegate = context.coordinator
        mtkView.preferredFramesPerSecond = 60
        context.coordinator.setup(mtkView: mtkView)
        return mtkView
    }
}
```

## Choosing the Right Approach

### Use SwiftUI Shader Effects When:

- Applying effects to existing SwiftUI views
- Creating shader-driven transitions
- Adding image processing (blur, color shifts, distortions)
- Building particle-like effects on views
- Simpler implementation is preferred

### Use MTKView Embedding When:

- Rendering custom 3D content
- Performing custom drawing with vertex shaders
- Managing multi-phase GPU rendering
- Using compute kernels
- Building games or interactive 3D scenes
- Needing advanced Metal features (multiple render passes, custom blending)

## Performance Considerations

1. **Shader complexity** - Keep shaders efficient; GPU time matters
2. **maxSampleOffset** - Set accurately; larger values = more GPU work
3. **Frame rate** - Use `TimelineView(.animation)` for smooth updates
4. **Memory** - Large textures consume GPU memory
5. **Profiling** - Use Xcode's GPU profiler for optimization
6. **Debug UI** - Build parameter scrubbers for rapid iteration

## Best Practices

1. **Experiment boldly** - Turn parameters up to explore boundaries
2. **Live with effects** - Test over time to ensure they're pleasant, not distracting
3. **Context matters** - Effects should fit naturally within the larger app
4. **Build debug tools** - Scrubbers and visualizers accelerate development
5. **Consider accessibility** - Ensure effects don't impair usability

## Ready-to-Use Shader Effects (from Inferno)

The following shaders are adapted from [Inferno](https://github.com/twostraws/Inferno) by Paul Hudson (MIT License). Inferno is an excellent open-source collection of fragment shaders designed for SwiftUI apps, with comprehensive documentation and beginner-friendly code.

### Water Ripple Effect

A distortion shader that creates animated water ripples.

```metal
// Water.metal - from Inferno (https://github.com/twostraws/Inferno)
// MIT License - Copyright (c) 2023 Paul Hudson

[[stitchable]] float2 water(
    float2 position,
    float2 size,
    float time,
    float speed,      // 0.5-10, start with 3
    float strength,   // 1-5, start with 3
    float frequency   // 5-25, start with 10
) {
    // Normalize to UV space (0..1)
    float2 uv = position / size;

    // Adjust parameters
    float adjustedSpeed = time * speed * 0.05f;
    float adjustedStrength = strength / 100.0f;

    // Wrap phase to avoid large trig arguments
    const float TWO_PI = 6.28318530718f;
    float phase = fmod(adjustedSpeed * frequency, TWO_PI);

    // Apply sine/cosine distortion
    float argX = frequency * uv.x + phase;
    float argY = frequency * uv.y + phase;
    uv.x += fast::sin(argX) * adjustedStrength;
    uv.y += fast::cos(argY) * adjustedStrength;

    return uv * size;
}
```

```swift
// SwiftUI Usage
struct WaterEffectView: View {
    @State private var startTime = Date.now

    var body: some View {
        TimelineView(.animation) { timeline in
            let elapsedTime = startTime.distance(to: timeline.date)

            Image("photo")
                .resizable()
                .aspectRatio(contentMode: .fit)
                .drawingGroup()
                .visualEffect { content, proxy in
                    content.distortionEffect(
                        ShaderLibrary.water(
                            .float2(proxy.size),
                            .float(elapsedTime),
                            .float(3),   // speed
                            .float(3),   // strength
                            .float(10)   // frequency
                        ),
                        maxSampleOffset: .zero
                    )
                }
        }
    }
}
```

### Emboss Effect

Creates a 3D relief/embossed appearance.

```metal
// Emboss.metal - from Inferno (https://github.com/twostraws/Inferno)
// MIT License - Copyright (c) 2023 Paul Hudson

[[stitchable]] half4 emboss(
    float2 position,
    SwiftUI::Layer layer,
    float strength  // How far to read pixels, try 1-20
) {
    // Read current pixel
    half4 currentColor = layer.sample(position);
    half4 newColor = currentColor;

    // Add brightness from one diagonal direction
    newColor += layer.sample(position + 1.0) * strength;

    // Subtract brightness from opposite direction
    newColor -= layer.sample(position - 1.0) * strength;

    // Preserve original alpha for smooth edges
    return half4(newColor) * currentColor.a;
}
```

```swift
// SwiftUI Usage
Image("photo")
    .layerEffect(
        ShaderLibrary.emboss(.float(5)),
        maxSampleOffset: .zero
    )
```

### Color Planes (RGB Glitch)

Separates RGB channels for a glitch effect - great with accelerometer data.

```metal
// ColorPlanes.metal - from Inferno (https://github.com/twostraws/Inferno)
// MIT License - Copyright (c) 2023 Paul Hudson

[[stitchable]] half4 colorPlanes(
    float2 position,
    SwiftUI::Layer layer,
    float2 offset  // How much to offset colors
) {
    // Red channel: double offset
    float2 red = position - (offset * 2.0);

    // Blue channel: single offset
    float2 blue = position - offset;

    // Green from original position
    half4 color = layer.sample(position);

    // Replace red and blue channels
    color.r = layer.sample(red).r;
    color.b = layer.sample(blue).b;

    // Multiply by alpha for smooth edges
    return color * color.a;
}
```

```swift
// SwiftUI Usage - drag to offset
struct ColorPlanesView: View {
    @State private var offset = CGSize.zero

    var body: some View {
        Image("photo")
            .drawingGroup()
            .layerEffect(
                ShaderLibrary.colorPlanes(.float2(offset)),
                maxSampleOffset: .zero
            )
            .gesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { offset = $0.translation }
            )
    }
}
```

### Infrared Thermal Effect

Simulates thermal/infrared imaging by mapping brightness to a cold-to-hot color scale.

```metal
// Infrared.metal - from Inferno (https://github.com/twostraws/Inferno)
// MIT License - Copyright (c) 2023 Paul Hudson

[[stitchable]] half4 infrared(float2 position, half4 color) {
    if (color.a > 0) {
        // Define temperature colors
        half3 cold = half3(0.0h, 0.0h, 1.0h);    // Blue
        half3 medium = half3(1.0h, 1.0h, 0.0h);  // Yellow
        half3 hot = half3(1.0h, 0.0h, 0.0h);     // Red

        // Calculate luminance
        half3 grayValues = half3(0.2125h, 0.7154h, 0.0721h);
        half luma = dot(color.rgb, grayValues);

        // Map to temperature colors
        half3 newColor;
        if (luma < 0.5h) {
            newColor = mix(cold, medium, luma / 0.5h);
        } else {
            newColor = mix(medium, hot, (luma - 0.5h) / 0.5h);
        }

        return half4(newColor, 1.0h) * color.a;
    }
    return color;
}
```

```swift
// SwiftUI Usage
Image("photo")
    .colorEffect(ShaderLibrary.infrared())
```

### White Noise

Generates dynamic grayscale static noise.

```metal
// WhiteNoise.metal - from Inferno (https://github.com/twostraws/Inferno)
// MIT License - Copyright (c) 2023 Paul Hudson

float whiteRandom(float offset, float2 position, float time) {
    float2 nonRepeating = float2(12.9898 * time, 78.233 * time);
    float sum = dot(position, nonRepeating);
    float sine = sin(sum);
    float hugeNumber = sine * 43758.5453 * offset;
    return fract(hugeNumber);
}

[[stitchable]] half4 whiteNoise(float2 position, half4 color, float time) {
    if (color.a > 0.0h) {
        return half4(half3(whiteRandom(1.0, position, time)), 1.0h) * color.a;
    }
    return color;
}
```

```swift
// SwiftUI Usage
struct NoiseView: View {
    @State private var startTime = Date.now

    var body: some View {
        TimelineView(.animation) { timeline in
            let elapsedTime = startTime.distance(to: timeline.date)

            Rectangle()
                .colorEffect(ShaderLibrary.whiteNoise(.float(elapsedTime)))
        }
    }
}
```

### Loupe (Magnifier)

Creates a circular zoom effect at a touch location.

```metal
// SimpleLoupe.metal - from Inferno (https://github.com/twostraws/Inferno)
// MIT License - Copyright (c) 2023 Paul Hudson

[[stitchable]] half4 simpleLoupe(
    float2 position,
    SwiftUI::Layer layer,
    float2 size,
    float2 touch,        // Touch location
    float maxDistance,   // Loupe size, try 0.05
    float zoomFactor     // Zoom amount, try 2
) {
    // Calculate UV coordinates
    half2 uv = half2(position / size);
    half2 center = half2(touch / size);
    half2 delta = uv - center;

    // Calculate distance with aspect ratio correction
    half aspectRatio = size.x / size.y;
    half distance = (delta.x * delta.x) + (delta.y * delta.y) / aspectRatio;

    // Apply zoom inside loupe area
    half totalZoom = 1.0h;
    if (distance < maxDistance) {
        totalZoom /= zoomFactor;
    }

    // Calculate zoomed position
    half2 newPosition = delta * totalZoom + center;

    return layer.sample(float2(newPosition) * size);
}
```

```swift
// SwiftUI Usage
struct LoupeView: View {
    @State private var touchLocation = CGPoint.zero

    var body: some View {
        Image("photo")
            .resizable()
            .aspectRatio(contentMode: .fit)
            .drawingGroup()
            .visualEffect { content, proxy in
                content.layerEffect(
                    ShaderLibrary.simpleLoupe(
                        .float2(proxy.size),
                        .float2(touchLocation),
                        .float(0.05),  // loupe size
                        .float(2)      // zoom factor
                    ),
                    maxSampleOffset: .zero
                )
            }
            .gesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { touchLocation = $0.location }
            )
    }
}
```

### Shimmer Effect

Animated diagonal highlight sweep - great for loading states.

```metal
// Shimmer.metal - from Inferno (https://github.com/twostraws/Inferno)
// MIT License - Copyright (c) 2023 Paul Hudson

// RGB to HSL conversion
half3 rgbToHSL(half3 rgb) {
    half minVal = min3(rgb.r, rgb.g, rgb.b);
    half maxVal = max3(rgb.r, rgb.g, rgb.b);
    half delta = maxVal - minVal;

    half3 hsl = half3(0.0h, 0.0h, 0.5h * (maxVal + minVal));

    if (delta > 0.0h) {
        if (maxVal == rgb.r) {
            hsl[0] = fmod((rgb.g - rgb.b) / delta, 6.0h);
        } else if (maxVal == rgb.g) {
            hsl[0] = (rgb.b - rgb.r) / delta + 2.0h;
        } else {
            hsl[0] = (rgb.r - rgb.g) / delta + 4.0h;
        }
        hsl[0] /= 6.0h;
        if (hsl[2] > 0.0h && hsl[2] < 1.0h) {
            hsl[1] = delta / (1.0h - abs(2.0h * hsl[2] - 1.0h));
        }
    }
    return hsl;
}

// HSL to RGB conversion
half3 hslToRGB(half3 hsl) {
    half c = (1.0h - abs(2.0h * hsl[2] - 1.0h)) * hsl[1];
    half h = hsl[0] * 6.0h;
    half x = c * (1.0h - abs(fmod(h, 2.0h) - 1.0h));

    half3 rgb;
    if (h < 1.0h) rgb = half3(c, x, 0.0h);
    else if (h < 2.0h) rgb = half3(x, c, 0.0h);
    else if (h < 3.0h) rgb = half3(0.0h, c, x);
    else if (h < 4.0h) rgb = half3(0.0h, x, c);
    else if (h < 5.0h) rgb = half3(x, 0.0h, c);
    else rgb = half3(c, 0.0h, x);

    return rgb + (hsl[2] - 0.5h * c);
}

[[stitchable]] half4 shimmer(
    float2 position,
    half4 color,
    float2 size,
    float time,
    float animationDuration,  // Loop duration in seconds
    float gradientWidth,      // Width of shimmer in UV space
    float maxLightness        // Peak brightness boost
) {
    if (color.a == 0.0h) return color;

    // Calculate animation progress
    float loopedProgress = fmod(time, float(animationDuration));
    half progress = loopedProgress / animationDuration;

    // Convert to UV space
    half2 uv = half2(position / size);

    // Calculate gradient bounds
    half minU = 0.0h - gradientWidth;
    half maxU = 1.0h + gradientWidth;
    half start = minU + maxU * progress + gradientWidth * uv.y;
    half end = start + gradientWidth;

    if (uv.x > start && uv.x < end) {
        half gradient = smoothstep(start, end, uv.x);
        half intensity = sin(gradient * M_PI_H);

        // Adjust lightness in HSL space
        half3 hsl = rgbToHSL(color.rgb);
        hsl[2] = hsl[2] + half(maxLightness * (maxLightness > 0.0h ? 1 - hsl[2] : hsl[2])) * intensity;
        color.rgb = hslToRGB(hsl);
    }

    return color;
}
```

```swift
// SwiftUI Usage
struct ShimmerView: View {
    @State private var startTime = Date.now

    var body: some View {
        TimelineView(.animation) { timeline in
            let elapsedTime = startTime.distance(to: timeline.date)

            Text("Loading...")
                .font(.largeTitle)
                .foregroundStyle(.gray)
                .visualEffect { content, proxy in
                    content.colorEffect(
                        ShaderLibrary.shimmer(
                            .float2(proxy.size),
                            .float(elapsedTime),
                            .float(2.0),   // animation duration
                            .float(0.3),   // gradient width
                            .float(0.8)    // max lightness
                        )
                    )
                }
        }
    }
}
```

## Transition Shaders (from Inferno)

Inferno also provides shader-based view transitions. These require both the Metal shader and a SwiftUI `AnyTransition` extension.

### Pixellate Transition

Views pixellate while fading between states.

```metal
// Pixellate.metal - from Inferno (https://github.com/twostraws/Inferno)
// MIT License - Copyright (c) 2023 Paul Hudson

[[stitchable]] half4 pixellate(
    float2 position,
    SwiftUI::Layer layer,
    float2 size,
    float amount,   // Progress 0-1
    float squares,  // Number of pixel squares
    float steps     // Animation steps (lower = more retro)
) {
    half2 uv = half2(position / size);

    // Direction goes 0 -> 0.5 -> 0
    half direction = min(amount, 1.0 - amount);

    // Quantize for stepped animation
    half steppedProgress = ceil(direction * steps) / steps;
    half2 squareSize = 2.0h * steppedProgress / half2(squares);

    half2 newPosition;
    if (steppedProgress == 0.0h) {
        newPosition = uv;
    } else {
        newPosition = (floor(uv / squareSize) + 0.5h) * squareSize;
    }

    // Blend with transparency as transition progresses
    return mix(layer.sample(float2(newPosition) * size), 0.0h, amount);
}
```

### Swirl Transition

Vortex effect that twists views during transition.

```metal
// Swirl.metal - from Inferno (https://github.com/twostraws/Inferno)
// MIT License - Copyright (c) 2023 Paul Hudson

[[stitchable]] half4 swirl(
    float2 position,
    SwiftUI::Layer layer,
    float2 size,
    float amount,  // Progress 0-1
    float radius   // Swirl radius relative to view, try 0.5
) {
    half2 uv = half2(position / size);
    uv -= 0.5h;

    half distanceFromCenter = length(uv);

    if (distanceFromCenter < radius) {
        half swirlStrength = (radius - distanceFromCenter) / radius;

        // Swirl intensity: 0->1->0 during transition
        half swirlAmount;
        if (amount <= 0.5) {
            swirlAmount = mix(0.0h, 1.0h, half(amount) / 0.5h);
        } else {
            swirlAmount = mix(1.0h, 0.0h, (half(amount) - 0.5h) / 0.5h);
        }

        half swirlAngle = swirlStrength * swirlStrength * swirlAmount * 8.0h * M_PI_H;

        // Rotate UV coordinates
        half sinAngle = sin(swirlAngle);
        half cosAngle = cos(swirlAngle);
        uv = half2(
            dot(uv, half2(cosAngle, -sinAngle)),
            dot(uv, half2(sinAngle, cosAngle))
        );
    }

    uv += 0.5h;
    return mix(layer.sample(float2(uv) * size), 0.0h, amount);
}
```

```swift
// Transition usage example
struct TransitionDemo: View {
    @State private var showingFirst = true

    var body: some View {
        VStack {
            if showingFirst {
                Image(systemName: "star.fill")
                    .font(.system(size: 200))
                    .foregroundStyle(.yellow)
                    .drawingGroup()
                    .transition(.swirl(radius: 0.5))
            } else {
                Image(systemName: "heart.fill")
                    .font(.system(size: 200))
                    .foregroundStyle(.red)
                    .drawingGroup()
                    .transition(.swirl(radius: 0.5))
            }

            Button("Toggle") {
                withAnimation(.easeInOut(duration: 1.5)) {
                    showingFirst.toggle()
                }
            }
        }
    }
}
```

## Metal Shading Language Reference

### Common Data Types

| Type | Description | Swift Equivalent |
|------|-------------|------------------|
| `float` | 32-bit float | `Float`, `CGFloat`, `Double` via `.float()` |
| `float2` | 2D vector | `CGPoint`, `CGSize` via `.float2()` |
| `float4` | 4D vector | - |
| `half` | 16-bit float (faster on GPU) | - |
| `half3` | RGB color | - |
| `half4` | RGBA color | `Color` via `.color()` |
| `uint2` | Integer 2D vector | - |

### Numeric Literals

```metal
float x = 0.5;      // or 0.5f, 0.5F
half h = 0.5h;      // or 0.5H (use h suffix for half precision)
int i = 42;
uint u = 42u;       // or 42U
```

### Common Functions

| Function | Description |
|----------|-------------|
| `abs(x)` | Absolute value |
| `ceil(x)` | Round up |
| `floor(x)` | Round down |
| `fract(x)` | Fractional part |
| `fmod(x, y)` | Remainder of x/y |
| `min(a, b)` | Minimum value |
| `max(a, b)` | Maximum value |
| `mix(a, b, t)` | Linear interpolation |
| `smoothstep(e0, e1, x)` | S-curve interpolation |
| `sin(x)`, `cos(x)` | Trigonometry (radians) |
| `fast::sin(x)` | Fast approximation |
| `pow(x, y)` | x raised to power y |
| `dot(a, b)` | Dot product |
| `length(v)` | Vector length |
| `normalize(v)` | Unit vector |
| `distance(a, b)` | Distance between points |
| `layer.sample(pos)` | Sample layer color at position |

### Performance Tips

1. **Prefer `half` over `float`** - Half precision is faster on mobile GPUs
2. **Use `fast::sin()` and `fast::cos()`** - Good enough for visual effects
3. **Precompute on CPU** - Calculate constants in Swift, pass as uniforms
4. **Avoid branching** - Use `mix()` and `step()` instead of `if/else`
5. **Minimize texture samples** - Each `layer.sample()` is expensive

## Sources

- WWDC 2024 - Create custom visual effects with SwiftUI
- WWDC 2023 - Create custom visual effects with SwiftUI
- [Inferno](https://github.com/twostraws/Inferno) by Paul Hudson - MIT License
- Apple Developer Documentation - Metal Shading Language
- Apple Developer Documentation - TextRenderer
- Apple Developer Forums - MetalKit in SwiftUI
- [The Book of Shaders](https://thebookofshaders.com) - Shader fundamentals
- [ShaderToy](https://www.shadertoy.com) - Shader inspiration and examples
- [GL Transitions](https://www.gl-transitions.com) - Transition effects
