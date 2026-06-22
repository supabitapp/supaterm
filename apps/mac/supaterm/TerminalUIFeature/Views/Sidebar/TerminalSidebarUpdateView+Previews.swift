import ComposableArchitecture
import Foundation
import SupatermUpdateFeature
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
    TerminalSidebarUpdatePreviewItem(
      title: "Permission Request",
      phase: .permissionRequest
    ),
    TerminalSidebarUpdatePreviewItem(
      title: "Checking",
      phase: .checking
    ),
    TerminalSidebarUpdatePreviewItem(
      title: "Update Available",
      phase: .updateAvailable(
        UpdatePhase.Available(
          buildVersion: "1000",
          contentLength: 82_300_000,
          releaseDate: Date(timeIntervalSince1970: 1_742_582_400),
          version: "0.18.0"
        )
      )
    ),
    TerminalSidebarUpdatePreviewItem(
      title: "Downloading",
      phase: .downloading(
        UpdatePhase.Downloading(
          expectedLength: 82_300_000,
          progress: 46_900_000
        )
      )
    ),
    TerminalSidebarUpdatePreviewItem(
      title: "Extracting",
      phase: .extracting(
        UpdatePhase.Extracting(progress: 0.72)
      )
    ),
    TerminalSidebarUpdatePreviewItem(
      title: "Installing",
      phase: .installing(
        UpdatePhase.Installing(isAutoUpdate: false)
      )
    ),
    TerminalSidebarUpdatePreviewItem(
      title: "Auto Update Ready",
      phase: .installing(
        UpdatePhase.Installing(isAutoUpdate: true)
      )
    ),
    TerminalSidebarUpdatePreviewItem(
      title: "No Updates Found",
      phase: .notFound
    ),
    TerminalSidebarUpdatePreviewItem(
      title: "Error",
      phase: .error(
        UpdatePhase.Failure(message: "Unable to reach the update server.")
      )
    ),
  ]
}

private struct TerminalSidebarUpdatePreviewGallery: View {
  let colorScheme: ColorScheme

  private var palette: TerminalPalette {
    TerminalPalette(colorScheme: colorScheme)
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

private struct TerminalSidebarUpdatePreviewColumn: View {
  let title: String
  let colorScheme: ColorScheme

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      Text(title)
        .font(.system(size: 13, weight: .semibold))
        .foregroundStyle(.secondary)

      TerminalSidebarUpdatePreviewGallery(colorScheme: colorScheme)
        .environment(\.colorScheme, colorScheme)
    }
    .frame(width: 320, alignment: .leading)
  }
}

private struct TerminalSidebarUpdatePreviewComparison: View {
  var body: some View {
    ScrollView(.horizontal) {
      HStack(alignment: .top, spacing: 16) {
        TerminalSidebarUpdatePreviewColumn(
          title: "Light",
          colorScheme: .light
        )

        TerminalSidebarUpdatePreviewColumn(
          title: "Dark",
          colorScheme: .dark
        )
      }
      .padding(16)
    }
    .frame(width: 704, height: 1040)
  }
}

#Preview("Sidebar Update States") {
  TerminalSidebarUpdatePreviewComparison()
}
