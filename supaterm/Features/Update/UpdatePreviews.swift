import ComposableArchitecture
import SwiftUI

private struct UpdatePreviewScenario: Identifiable {
  let id: String
  let phase: UpdatePhase

  static let pillScenarios: [Self] = [
    .init(
      id: "Checking",
      phase: .checking
    ),
    .init(
      id: "Available",
      phase: .updateAvailable(
        .init(
          contentLength: 146_800_640,
          publishedAt: .now,
          releaseNotesURL: URL(string: "https://supaterm.app/releases/latest"),
          version: "0.4.0"
        )
      )
    ),
    .init(
      id: "Downloading",
      phase: .downloading(
        .init(
          expectedLength: 146_800_640,
          receivedLength: 73_400_320
        )
      )
    ),
    .init(
      id: "Preparing",
      phase: .extracting(0.72)
    ),
    .init(
      id: "Installed",
      phase: .installing(.init(canInstallNow: true))
    ),
    .init(
      id: "No Update",
      phase: .notFound
    ),
    .init(
      id: "Error",
      phase: .error("The update feed could not be loaded.")
    ),
  ]

  static let popoverScenarios: [Self] = [
    .init(
      id: "Permission",
      phase: .permissionRequest
    ),
    .init(
      id: "Checking",
      phase: .checking
    ),
    .init(
      id: "Available",
      phase: .updateAvailable(
        .init(
          contentLength: 146_800_640,
          publishedAt: .now,
          releaseNotesURL: URL(string: "https://supaterm.app/releases/latest"),
          version: "0.4.0"
        )
      )
    ),
    .init(
      id: "Restart",
      phase: .installing(.init(canInstallNow: true))
    ),
    .init(
      id: "No Update",
      phase: .notFound
    ),
    .init(
      id: "Error",
      phase: .error("Supaterm could not verify the appcast signature.")
    ),
  ]
}

private enum UpdatePreviewStore {
  static func make(phase: UpdatePhase) -> StoreOf<UpdateFeature> {
    Store(
      initialState: .init(
        canCheckForUpdates: true,
        isPopoverPresented: false,
        phase: phase
      )
    ) {
      UpdateFeature()
    } withDependencies: {
      $0.updateClient = .testValue
    }
  }
}

#Preview("Update Pill States") {
  ScrollView {
    VStack(alignment: .leading, spacing: 16) {
      ForEach(UpdatePreviewScenario.pillScenarios) { scenario in
        VStack(alignment: .leading, spacing: 8) {
          Text(scenario.id)
            .font(.system(size: 11, weight: .semibold))
            .foregroundStyle(.secondary)

          UpdatePillView(store: UpdatePreviewStore.make(phase: scenario.phase))
        }
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding(20)
  }
  .frame(width: 360, height: 420)
  .background(.thinMaterial)
}

#Preview("Update Popover States") {
  ScrollView {
    VStack(alignment: .leading, spacing: 18) {
      ForEach(UpdatePreviewScenario.popoverScenarios) { scenario in
        VStack(alignment: .leading, spacing: 8) {
          Text(scenario.id)
            .font(.system(size: 11, weight: .semibold))
            .foregroundStyle(.secondary)

          UpdatePopoverView(store: UpdatePreviewStore.make(phase: scenario.phase))
            .background(Color(nsColor: .windowBackgroundColor))
            .clipShape(.rect(cornerRadius: 12))
            .overlay {
              RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(Color(nsColor: .separatorColor), lineWidth: 0.5)
            }
        }
      }
    }
    .padding(20)
  }
  .frame(width: 360, height: 820)
  .background(Color(nsColor: .underPageBackgroundColor))
}
