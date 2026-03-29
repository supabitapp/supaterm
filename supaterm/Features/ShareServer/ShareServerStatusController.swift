import ComposableArchitecture
import Combine
import Foundation

@MainActor
final class ShareServerStatusController: ObservableObject {
  @Published private(set) var snapshot = ShareServerSnapshot()
  private let shareServerClient: ShareServerClient

  private var observationTask: Task<Void, Never>?

  init(shareServerClient: ShareServerClient) {
    self.shareServerClient = shareServerClient
  }

  func startObservingIfNeeded() {
    guard observationTask == nil else { return }

    observationTask = Task { [shareServerClient] in
      let snapshots = await shareServerClient.observe()
      for await snapshot in snapshots {
        await MainActor.run {
          self.snapshot = snapshot
        }
      }
    }
  }

  func startSharing(port: Int) {
    Task { [shareServerClient] in
      await shareServerClient.start(port, nil)
    }
  }

  func stopSharing() {
    Task { [shareServerClient] in
      await shareServerClient.stop()
    }
  }

  deinit {
    observationTask?.cancel()
  }
}
