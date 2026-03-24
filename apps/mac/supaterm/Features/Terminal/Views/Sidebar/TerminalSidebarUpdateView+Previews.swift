import ComposableArchitecture
import Foundation
import SwiftUI

private struct TerminalSidebarUpdatePreviewItem: Identifiable {
  let title: String
  let phase: UpdatePhase

  var id: String {
    title
  }
}

private enum TerminalSidebarUpdatePreviewFixtures {
  static let items: [TerminalSidebarUpdatePreviewItem] = [
    .init(
      title: "Permission Request",
      phase: .permissionRequest
    ),
    .init(
      title: "Checking",
      phase: .checking
    ),
    .init(
      title: "Update Available",
      phase: .updateAvailable(
        .init(
          contentLength: 82_300_000,
          releaseDate: Date(timeIntervalSince1970: 1_742_582_400),
          version: "0.18.0"
        )
      )
    ),
    .init(
      title: "Downloading",
      phase: .downloading(
        .init(
          expectedLength: 82_300_000,
          progress: 46_900_000
        )
      )
    ),
    .init(
      title: "Extracting",
      phase: .extracting(
        .init(progress: 0.72)
      )
    ),
    .init(
      title: "Installing",
      phase: .installing(
        .init(isAutoUpdate: false)
      )
    ),
    .init(
      title: "Auto Update Ready",
      phase: .installing(
        .init(isAutoUpdate: true)
      )
    ),
    .init(
      title: "No Updates Found",
      phase: .notFound
    ),
    .init(
      title: "Error",
      phase: .error(
        .init(message: "Unable to reach the update server.")
      )
    ),
  ]
}

private struct TerminalSidebarUpdatePreviewGallery: View {
  let colorScheme: ColorScheme

  private var palette: TerminalPalette {
    .init(colorScheme: colorScheme)
  }

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 12) {
        ForEach(TerminalSidebarUpdatePreviewFixtures.items) { item in
          VStack(alignment: .leading, spacing: 6) {
            Text(item.title)
              .font(.system(size: 11, weight: .semibold))
              .foregroundStyle(palette.secondaryText)

            TerminalSidebarUpdateSection(
              store: previewStore(phase: item.phase),
              palette: palette
            )
          }
        }
      }
      .padding(8)
      .padding(.top, 6)
      .padding(.bottom, 8)
      .frame(maxWidth: .infinity, alignment: .leading)
    }
    .frame(width: 320, height: 980)
    .background(palette.windowBackgroundTint)
    .background(palette.detailBackground)
    .preferredColorScheme(colorScheme)
  }

  private func previewStore(
    phase: UpdatePhase
  ) -> StoreOf<UpdateFeature> {
    var state = UpdateFeature.State()
    state.canCheckForUpdates = true
    state.phase = phase

    return Store(initialState: state) {
      UpdateFeature()
    } withDependencies: {
      $0.updateClient = .testValue
    }
  }
}

#Preview("Sidebar Update States - Light") {
  TerminalSidebarUpdatePreviewGallery(colorScheme: .light)
}

#Preview("Sidebar Update States - Dark") {
  TerminalSidebarUpdatePreviewGallery(colorScheme: .dark)
}
