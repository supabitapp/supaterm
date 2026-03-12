import AppKit
import ComposableArchitecture
import SwiftUI

struct UpdatePopoverView: View {
  let store: StoreOf<UpdateFeature>

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      switch store.phase {
      case .idle:
        EmptyView()

      case .permissionRequest:
        permissionRequestView

      case .checking:
        checkingView

      case .updateAvailable(let info):
        updateAvailableView(info)

      case .downloading:
        EmptyView()

      case .extracting:
        EmptyView()

      case .installing(let installing):
        installingView(installing)

      case .notFound:
        notFoundView

      case .error(let message):
        errorView(message)
      }
    }
    .frame(width: 300)
  }

  private var checkingView: some View {
    VStack(alignment: .leading, spacing: 16) {
      HStack(spacing: 10) {
        ProgressView()
          .controlSize(.small)
        Text(store.phase.text)
          .font(.system(size: 13))
      }

      HStack {
        Spacer()
        Button("Cancel") {
          store.send(.cancelButtonTapped)
        }
        .keyboardShortcut(.cancelAction)
        .controlSize(.small)
      }
    }
    .padding(16)
  }

  private func errorView(_ message: String) -> some View {
    VStack(alignment: .leading, spacing: 16) {
      VStack(alignment: .leading, spacing: 8) {
        HStack(spacing: 8) {
          Image(systemName: "exclamationmark.triangle.fill")
            .foregroundStyle(.orange)
          Text(store.phase.title)
            .font(.system(size: 13, weight: .semibold))
        }

        Text(message)
          .font(.system(size: 11))
          .foregroundStyle(.secondary)
          .fixedSize(horizontal: false, vertical: true)
      }

      HStack(spacing: 8) {
        Button("OK") {
          store.send(.dismissButtonTapped)
        }
        .keyboardShortcut(.cancelAction)
        .controlSize(.small)

        Spacer()

        Button("Retry") {
          store.send(.retryButtonTapped)
        }
        .keyboardShortcut(.defaultAction)
        .controlSize(.small)
      }
    }
    .padding(16)
  }

  private func installingView(_ installing: UpdateInstallingState) -> some View {
    VStack(alignment: .leading, spacing: 16) {
      VStack(alignment: .leading, spacing: 8) {
        Text(store.phase.title)
          .font(.system(size: 13, weight: .semibold))

        Text(store.phase.detailMessage)
          .font(.system(size: 11))
          .foregroundStyle(.secondary)
          .fixedSize(horizontal: false, vertical: true)
      }

      HStack {
        Button("Restart Later") {
          store.send(.dismissButtonTapped)
        }
        .keyboardShortcut(.cancelAction)
        .controlSize(.small)

        Spacer()

        Button("Restart Now") {
          store.send(.restartNowButtonTapped)
        }
        .keyboardShortcut(.defaultAction)
        .buttonStyle(.borderedProminent)
        .controlSize(.small)
        .disabled(!installing.canInstallNow)
      }
    }
    .padding(16)
  }

  private var notFoundView: some View {
    VStack(alignment: .leading, spacing: 16) {
      VStack(alignment: .leading, spacing: 8) {
        Text(store.phase.title)
          .font(.system(size: 13, weight: .semibold))

        Text(store.phase.detailMessage)
          .font(.system(size: 11))
          .foregroundStyle(.secondary)
          .fixedSize(horizontal: false, vertical: true)
      }

      HStack {
        Spacer()
        Button("OK") {
          store.send(.dismissButtonTapped)
        }
        .keyboardShortcut(.defaultAction)
        .controlSize(.small)
      }
    }
    .padding(16)
  }

  private var permissionRequestView: some View {
    VStack(alignment: .leading, spacing: 16) {
      VStack(alignment: .leading, spacing: 8) {
        Text(store.phase.title)
          .font(.system(size: 13, weight: .semibold))

        Text(store.phase.detailMessage)
          .font(.system(size: 11))
          .foregroundStyle(.secondary)
          .fixedSize(horizontal: false, vertical: true)
      }

      HStack(spacing: 8) {
        Button("Not Now") {
          store.send(.dismissButtonTapped)
        }
        .keyboardShortcut(.cancelAction)

        Spacer()

        Button("Allow") {
          store.send(.allowAutomaticUpdatesButtonTapped)
        }
        .keyboardShortcut(.defaultAction)
        .buttonStyle(.borderedProminent)
      }
    }
    .padding(16)
  }

  private func updateAvailableView(_ info: UpdateInfo) -> some View {
    VStack(alignment: .leading, spacing: 0) {
      VStack(alignment: .leading, spacing: 12) {
        VStack(alignment: .leading, spacing: 8) {
          Text(store.phase.title)
            .font(.system(size: 13, weight: .semibold))

          VStack(alignment: .leading, spacing: 4) {
            detailsRow(label: "Version", value: info.version)

            if let contentLength = info.contentLength {
              detailsRow(
                label: "Size",
                value: ByteCountFormatter.string(
                  fromByteCount: Int64(contentLength),
                  countStyle: .file
                )
              )
            }

            if let publishedAt = info.publishedAt {
              detailsRow(
                label: "Released",
                value: publishedAt.formatted(date: .abbreviated, time: .omitted)
              )
            }
          }
          .textSelection(.enabled)
        }

        HStack(spacing: 8) {
          Button("Skip") {
            store.send(.skipButtonTapped)
          }
          .controlSize(.small)

          Button("Later") {
            store.send(.laterButtonTapped)
          }
          .controlSize(.small)
          .keyboardShortcut(.cancelAction)

          Spacer()

          Button("Install and Relaunch") {
            store.send(.installAndRelaunchButtonTapped)
          }
          .keyboardShortcut(.defaultAction)
          .buttonStyle(.borderedProminent)
          .controlSize(.small)
        }
      }
      .padding(16)

      if let releaseNotesURL = info.releaseNotesURL {
        Divider()

        Link(destination: releaseNotesURL) {
          HStack {
            Image(systemName: "doc.text")
              .font(.system(size: 11))
            Text("View Release Notes")
              .font(.system(size: 11, weight: .medium))
            Spacer()
            Image(systemName: "arrow.up.right")
              .font(.system(size: 10))
          }
          .foregroundStyle(.primary)
          .padding(12)
          .frame(maxWidth: .infinity)
          .background(Color(nsColor: .controlBackgroundColor))
          .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
      }
    }
  }

  private func detailsRow(label: String, value: String) -> some View {
    HStack(spacing: 6) {
      Text("\(label):")
        .foregroundStyle(.secondary)
        .frame(width: 60, alignment: .trailing)
      Text(value)
    }
    .font(.system(size: 11))
  }
}
