import AppKit
import SwiftUI

@main
struct SupatermInstallerApp: App {
  @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
  @StateObject private var installer = Installer()

  var body: some Scene {
    Window("Supaterm Installer", id: "installer") {
      InstallerView(installer: installer)
    }
    .windowResizability(.contentSize)
  }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
  func applicationShouldTerminateAfterLastWindowClosed(_: NSApplication) -> Bool { true }
}

@MainActor
final class Installer: ObservableObject {
  enum Phase: Equatable {
    case preparing
    case downloading(DownloadProgress)
    case verifying
    case waitingForQuit
    case installing(URL)
    case opening
    case installed(URL)
    case failed(String)
  }

  struct DownloadProgress: Equatable {
    let version: String
    let received: Int64
    let total: Int64
    let bytesPerSecond: Double?
  }

  @Published private(set) var phase = Phase.preparing
  private var task: Task<Void, Never>?
  private var quitRequested = false
  private var transferRate = TransferRate()
  private var activeDownload: UUID?

  func start() {
    task?.cancel()
    task = Task { await run() }
  }

  func quitRunningCopies() {
    quitRequested = true
  }

  func finish() {
    InstallerDiskImage.ejectAfterExit()
    NSApp.terminate(nil)
  }

  private func run() async {
    let workDirectory = FileManager.default.temporaryDirectory
      .appending(path: "supaterm-installer-\(UUID().uuidString)", directoryHint: .isDirectory)
    defer { try? FileManager.default.removeItem(at: workDirectory) }
    do {
      phase = .preparing
      let destination = try InstallSteps.destination()
      try FileManager.default.createDirectory(at: workDirectory, withIntermediateDirectories: true)
      let artifact = try await ReleaseFeed.latestArtifact()

      let download = UUID()
      activeDownload = download
      transferRate = TransferRate()
      phase = .downloading(
        DownloadProgress(version: artifact.version, received: 0, total: artifact.size, bytesPerSecond: nil)
      )
      let archive = try await InstallSteps.download(artifact, into: workDirectory) { received in
        Task { @MainActor [weak self] in self?.reportDownload(download, of: artifact, received: received) }
      }

      phase = .verifying
      try await background { try InstallSteps.verifyChecksum(of: archive, matches: artifact) }
      let extracted = try await InstallSteps.extractApp(from: archive, into: workDirectory.appending(path: "app"))
      try await background { try InstallSteps.verifySignature(of: extracted) }
      try await waitUntilClosed(destination)

      phase = .installing(destination)
      try await background { try InstallSteps.install(extracted, at: destination) }

      guard InstallSteps.opensAfterInstall else {
        phase = .installed(destination)
        return
      }
      phase = .opening
      do {
        _ = try await NSWorkspace.shared.openApplication(at: destination, configuration: .init())
      } catch {
        phase = .installed(destination)
        return
      }
      finish()
    } catch is CancellationError {
    } catch {
      phase = .failed(error.localizedDescription)
    }
  }

  // Progress arrives on unawaited tasks, so a late report from a finished or
  // abandoned download must not overwrite the phase that followed it.
  private func reportDownload(_ download: UUID, of artifact: ReleaseArtifact, received: Int64) {
    guard download == activeDownload, case .downloading = phase else { return }
    transferRate.record(received)
    phase = .downloading(
      DownloadProgress(
        version: artifact.version,
        received: received,
        total: artifact.size,
        bytesPerSecond: transferRate.bytesPerSecond
      )
    )
  }

  private func waitUntilClosed(_ destination: URL) async throws {
    let running = InstallSteps.runningCopies(of: destination)
    guard !running.isEmpty else { return }
    phase = .waitingForQuit
    quitRequested = false
    while running.contains(where: { !$0.isTerminated }) {
      if quitRequested {
        quitRequested = false
        running.forEach { $0.terminate() }
      }
      try await Task.sleep(for: .milliseconds(250))
    }
  }

  private func background(_ work: @escaping @Sendable () throws -> Void) async throws {
    try await Task.detached(priority: .userInitiated, operation: work).value
  }
}

// Smoothed so the speed and time remaining read steadily while samples arrive
// every megabyte.
struct TransferRate {
  private var lastSample: (time: ContinuousClock.Instant, bytes: Int64)?
  private(set) var bytesPerSecond: Double?

  mutating func record(_ bytes: Int64, at time: ContinuousClock.Instant = .now) {
    defer { lastSample = (time, bytes) }
    guard let lastSample, bytes > lastSample.bytes else { return }
    let seconds = (time - lastSample.time) / .seconds(1)
    guard seconds > 0 else { return }
    let sample = Double(bytes - lastSample.bytes) / seconds
    bytesPerSecond = bytesPerSecond.map { $0 * 0.8 + sample * 0.2 } ?? sample
  }
}

struct InstallerView: View {
  @ObservedObject var installer: Installer
  @State private var jokes = StatusJokes.all.shuffled()
  @State private var startedAt = Date()

  var body: some View {
    HStack(alignment: .top, spacing: 20) {
      Image(nsImage: NSApp.applicationIconImage)
        .resizable()
        .frame(width: 64, height: 64)
      VStack(alignment: .leading, spacing: 10) {
        title
          .font(.title3.weight(.semibold))
        content
      }
      .frame(maxWidth: .infinity, alignment: .leading)
    }
    .padding(.horizontal, 24)
    .padding(.vertical, 20)
    .frame(width: 480)
    .onAppear { installer.start() }
  }

  // While nothing needs the user, the title rotates through jokes and the
  // detail line carries the real status.
  @ViewBuilder
  private var title: some View {
    switch installer.phase {
    case .waitingForQuit:
      Text("Quit Supaterm to continue")
    case .installed:
      Text("Supaterm is installed")
    case .failed:
      Text("Supaterm wasn't installed")
    case .preparing, .downloading, .verifying, .installing, .opening:
      TimelineView(.periodic(from: startedAt, by: 3)) { context in
        let index = Int(context.date.timeIntervalSince(startedAt) / 3) % jokes.count
        Text("\(jokes[index])…")
      }
    }
  }

  @ViewBuilder
  private var content: some View {
    switch installer.phase {
    case let .downloading(progress):
      ProgressView(value: Double(progress.received), total: Double(max(progress.total, 1)))
      detail(downloadSummary(progress))
    case .waitingForQuit:
      detail("Supaterm is open. Quit it so the new version can replace it.")
      actions {
        Button("Cancel") { NSApp.terminate(nil) }
        Button("Quit Supaterm") { installer.quitRunningCopies() }
          .keyboardShortcut(.defaultAction)
      }
    case let .installed(destination):
      detail("Open it from \(destination.deletingLastPathComponent().path).")
      actions {
        Button("Show in Finder") { NSWorkspace.shared.activateFileViewerSelecting([destination]) }
        Button("Done") { installer.finish() }
          .keyboardShortcut(.defaultAction)
      }
    case let .failed(message):
      detail(message)
      actions {
        Button("Download Manually") {
          NSWorkspace.shared.open(ReleaseFeed.releasesURL.appending(path: "latest"))
        }
        Button("Try Again") { installer.start() }
          .keyboardShortcut(.defaultAction)
      }
    case .preparing:
      busy("Finding the latest version")
    case .verifying:
      busy("Checking the download")
    case let .installing(destination):
      busy("Installing to \(destination.deletingLastPathComponent().path)")
    case .opening:
      busy("Opening Supaterm")
    }
  }

  @ViewBuilder
  private func busy(_ text: String) -> some View {
    ProgressView()
      .progressViewStyle(.linear)
    detail(text)
  }

  private func detail(_ text: String) -> some View {
    Text(text)
      .foregroundStyle(.secondary)
      .monospacedDigit()
      .fixedSize(horizontal: false, vertical: true)
  }

  private func actions(@ViewBuilder _ buttons: () -> some View) -> some View {
    HStack {
      Spacer()
      buttons()
    }
    .padding(.top, 4)
  }

  private func downloadSummary(_ progress: Installer.DownloadProgress) -> String {
    let version = "v\(progress.version)"
    let sizes = "\(bytes(progress.received)) of \(bytes(progress.total))"
    guard let rate = progress.bytesPerSecond, rate > 0 else { return "\(version) • \(sizes)" }
    let remaining = Self.timeRemaining.string(from: Double(progress.total - progress.received) / rate) ?? ""
    return [version, "\(bytes(Int64(rate)))/s", sizes, remaining]
      .filter { !$0.isEmpty }
      .joined(separator: " • ")
  }

  private func bytes(_ count: Int64) -> String {
    ByteCountFormatter.string(fromByteCount: count, countStyle: .file)
  }

  private static let timeRemaining: DateComponentsFormatter = {
    let formatter = DateComponentsFormatter()
    formatter.allowedUnits = [.hour, .minute, .second]
    formatter.unitsStyle = .abbreviated
    formatter.maximumUnitCount = 2
    return formatter
  }()
}
