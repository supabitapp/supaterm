import AppKit
import SupaTheme
import SwiftUI
import Testing

@testable import supaterm

struct TerminalSidebarDragPresentationTests {
  @Test @MainActor
  func liftedGroupPreviewRendersItsCapturedTint() throws {
    let collectionView = NSCollectionView(frame: CGRect(x: 0, y: 0, width: 240, height: 200))
    let window = NSWindow(
      contentRect: collectionView.frame,
      styleMask: .borderless,
      backing: .buffered,
      defer: false
    )
    window.contentView = collectionView
    let sourceFrame = CGRect(x: 12, y: 20, width: 216, height: 120)
    let palette = Palette(colorScheme: .dark)
    let background = TerminalSidebarGroupBackgroundView(frame: sourceFrame)
    background.update(
      color: .orange,
      palette: palette,
      surfaceState: .resting,
      alpha: 1,
      reduceMotion: true
    )
    collectionView.addSubview(background)
    let presentation = TerminalSidebarDragPresentation(collectionView: collectionView)
    let rows = [
      CGRect(x: 12, y: 20, width: 216, height: 37),
      CGRect(x: 12, y: 59, width: 216, height: 37),
    ].map { rowFrame in
      TerminalSidebarLiftedRow(
        hostedView: NSView(frame: rowFrame),
        sourceFrame: rowFrame,
        restore: {}
      )
    }

    presentation.begin(
      TerminalSidebarDragPresentation.Lift(
        rows: rows,
        groupBackground: TerminalSidebarLiftedGroupBackground(
          id: TerminalTabGroupID(),
          view: background,
          sourceFrame: sourceFrame
        ),
        fanAnchorIndex: nil,
        sourceFrame: sourceFrame,
        hotspot: .zero,
        screenPoint: .zero,
        timestamp: 0
      ),
      motionPolicy: TerminalSidebarMotionPolicy(reduceMotion: true)
    )

    let liveView = try #require(background.superview)
    #expect(liveView !== collectionView)
    #expect(background.frame == sourceFrame.offsetBy(dx: -sourceFrame.minX, dy: -sourceFrame.minY))
    liveView.layoutSubtreeIfNeeded()
    background.needsLayout = true
    background.layoutSubtreeIfNeeded()
    let raster = try #require(DragPreviewRaster(view: background))
    let renderedColor = try #require(
      raster.color(
        at: CGPoint(x: background.bounds.midX, y: background.bounds.midY)
      )?.usingColorSpace(.deviceRGB)
    )
    let expectedColor = try #require(
      ThemeTint.orange.sidebarNSColor(palette: palette).usingColorSpace(.deviceRGB)
    )

    #expect(background.alphaValue == 1)
    #expect(renderedColor.alphaComponent > 0.1)
    #expect(abs(renderedColor.redComponent - expectedColor.redComponent) < 0.02)
    #expect(abs(renderedColor.greenComponent - expectedColor.greenComponent) < 0.02)
    #expect(abs(renderedColor.blueComponent - expectedColor.blueComponent) < 0.02)
  }

  @Test @MainActor
  func selectedSurfaceStaysWithTheLiftedRow() throws {
    let collectionView = NSCollectionView(frame: CGRect(x: 0, y: 0, width: 240, height: 400))
    let sourceFrame = CGRect(x: 12, y: 40, width: 216, height: 52)
    let hostedView = NSView(frame: CGRect(origin: .zero, size: sourceFrame.size))
    let selectedSurfaceView = TerminalSidebarSelectionGlowView(
      frame: sourceFrame.insetBy(dx: -4, dy: -4)
    )
    let selectedSurface = TerminalSidebarLiftedSelectionSurface(view: selectedSurfaceView)
    let presentation = TerminalSidebarDragPresentation(collectionView: collectionView)
    presentation.begin(
      TerminalSidebarDragPresentation.Lift(
        rows: [
          TerminalSidebarLiftedRow(
            hostedView: hostedView,
            sourceFrame: sourceFrame,
            selectedSurface: selectedSurface,
            restore: {}
          )
        ],
        groupBackground: nil,
        fanAnchorIndex: nil,
        sourceFrame: sourceFrame,
        hotspot: .zero,
        screenPoint: .zero,
        timestamp: 0
      ),
      motionPolicy: TerminalSidebarMotionPolicy(reduceMotion: true)
    )

    let liveView = try #require(hostedView.superview)
    #expect(selectedSurfaceView.superview === liveView)
    #expect(selectedSurfaceView.frame == CGRect(x: -4, y: -4, width: 224, height: 60))
  }

  @Test @MainActor
  func destinationHandoffKeepsThenDiscardsThePreviewRows() {
    let collectionView = NSCollectionView(frame: CGRect(x: 0, y: 0, width: 240, height: 400))
    let source = NSView(frame: CGRect(x: 12, y: 40, width: 216, height: 52))
    let hostedView = NSView(frame: source.bounds)
    source.addSubview(hostedView)
    var restored = false
    let row = TerminalSidebarLiftedRow(
      hostedView: hostedView,
      sourceFrame: source.frame,
      restore: {
        restored = true
        source.addSubview(hostedView)
        hostedView.frame = source.bounds
      }
    )
    let presentation = TerminalSidebarDragPresentation(collectionView: collectionView)
    presentation.begin(
      TerminalSidebarDragPresentation.Lift(
        rows: [row],
        groupBackground: nil,
        fanAnchorIndex: nil,
        sourceFrame: source.frame,
        hotspot: .zero,
        screenPoint: .zero,
        timestamp: 0
      ),
      motionPolicy: TerminalSidebarMotionPolicy(reduceMotion: true)
    )
    var previewWasInstalled = false
    var destinationWasCompleted = false
    var layoutPass = 0

    presentation.handoffToDestination {
      layoutPass += 1
      if layoutPass == 1 {
        previewWasInstalled = true
      } else {
        destinationWasCompleted = true
      }
    }

    #expect(previewWasInstalled)
    #expect(destinationWasCompleted)
    #expect(!restored)
    #expect(hostedView.superview == nil)
  }

  @Test @MainActor
  func cancellationRestoresTheCapturedSourceProjection() {
    let collectionView = NSCollectionView(frame: CGRect(x: 0, y: 0, width: 240, height: 400))
    let source = NSView(frame: CGRect(x: 12, y: 40, width: 216, height: 52))
    let hostedView = NSView(frame: source.bounds)
    let background = TerminalSidebarGroupBackgroundView(frame: source.frame)
    source.addSubview(hostedView)
    collectionView.addSubview(background)
    var restoreCount = 0
    let presentation = TerminalSidebarDragPresentation(collectionView: collectionView)
    presentation.begin(
      TerminalSidebarDragPresentation.Lift(
        rows: [
          TerminalSidebarLiftedRow(
            hostedView: hostedView,
            sourceFrame: source.frame,
            restore: {
              restoreCount += 1
              source.addSubview(hostedView)
            }
          )
        ],
        groupBackground: TerminalSidebarLiftedGroupBackground(
          id: TerminalTabGroupID(),
          view: background,
          sourceFrame: background.frame
        ),
        fanAnchorIndex: nil,
        sourceFrame: source.frame,
        hotspot: .zero,
        screenPoint: .zero,
        timestamp: 0
      ),
      motionPolicy: TerminalSidebarMotionPolicy(reduceMotion: true)
    )

    presentation.handoffToSource {}

    #expect(restoreCount == 1)
    #expect(hostedView.superview === source)
    #expect(background.superview === collectionView)
  }

  @Test @MainActor
  func externalSuccessDiscardsTheCapturedSourceProjection() {
    let collectionView = NSCollectionView(frame: CGRect(x: 0, y: 0, width: 240, height: 400))
    let source = NSView(frame: CGRect(x: 12, y: 40, width: 216, height: 52))
    let hostedView = NSView(frame: source.bounds)
    let background = TerminalSidebarGroupBackgroundView(frame: source.frame)
    source.addSubview(hostedView)
    collectionView.addSubview(background)
    var restoreCount = 0
    let presentation = TerminalSidebarDragPresentation(collectionView: collectionView)
    presentation.begin(
      TerminalSidebarDragPresentation.Lift(
        rows: [
          TerminalSidebarLiftedRow(
            hostedView: hostedView,
            sourceFrame: source.frame,
            restore: { restoreCount += 1 }
          )
        ],
        groupBackground: TerminalSidebarLiftedGroupBackground(
          id: TerminalTabGroupID(),
          view: background,
          sourceFrame: background.frame
        ),
        fanAnchorIndex: nil,
        sourceFrame: source.frame,
        hotspot: .zero,
        screenPoint: .zero,
        timestamp: 0
      ),
      motionPolicy: TerminalSidebarMotionPolicy(reduceMotion: true)
    )

    presentation.handoffAfterExternalSuccess(.removed) {}

    #expect(restoreCount == 0)
    #expect(hostedView.superview == nil)
    #expect(background.superview == nil)
  }

  @Test @MainActor
  func retainedExternalSuccessRestoresTheCapturedSourceProjection() {
    let collectionView = NSCollectionView(frame: CGRect(x: 0, y: 0, width: 240, height: 400))
    let source = NSView(frame: CGRect(x: 12, y: 40, width: 216, height: 52))
    let hostedView = NSView(frame: source.bounds)
    source.addSubview(hostedView)
    var restoreCount = 0
    let presentation = TerminalSidebarDragPresentation(collectionView: collectionView)
    presentation.begin(
      TerminalSidebarDragPresentation.Lift(
        rows: [
          TerminalSidebarLiftedRow(
            hostedView: hostedView,
            sourceFrame: source.frame,
            restore: {
              restoreCount += 1
              source.addSubview(hostedView)
            }
          )
        ],
        groupBackground: nil,
        fanAnchorIndex: nil,
        sourceFrame: source.frame,
        hotspot: .zero,
        screenPoint: .zero,
        timestamp: 0
      ),
      motionPolicy: TerminalSidebarMotionPolicy(reduceMotion: true)
    )

    presentation.handoffAfterExternalSuccess(.retained) {}

    #expect(restoreCount == 1)
    #expect(hostedView.superview === source)
  }
}

private struct DragPreviewRaster {
  private let image: NSBitmapImageRep

  @MainActor
  init?(view: NSView) {
    guard
      let layer = view.layer,
      let context = CGContext(
        data: nil,
        width: Int(view.bounds.width),
        height: Int(view.bounds.height),
        bitsPerComponent: 8,
        bytesPerRow: 0,
        space: CGColorSpaceCreateDeviceRGB(),
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
      )
    else { return nil }
    layer.render(in: context)
    guard let cgImage = context.makeImage() else { return nil }
    image = NSBitmapImageRep(cgImage: cgImage)
  }

  func color(at point: CGPoint) -> NSColor? {
    image.colorAt(x: Int(point.x), y: Int(point.y))
  }
}
