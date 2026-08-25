import ComposableArchitecture
import SupatermSupport
import SwiftUI

struct SettingsHostsView: View {
  let store: StoreOf<SettingsFeature>

  @State private var name = ""
  @State private var destination = ""
  @State private var sshArguments = ""

  private var draft: SupatermRemoteHost {
    SupatermRemoteHost(
      id: SupatermRemoteHost.normalizedID(name),
      destination: destination.trimmingCharacters(in: .whitespacesAndNewlines),
      sshArguments:
        sshArguments
        .split(whereSeparator: \.isNewline)
        .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
        .filter { !$0.isEmpty }
    )
  }

  private var canAdd: Bool {
    draft.validationError == nil && !store.remoteHosts.contains(where: { $0.id == draft.id })
  }

  var body: some View {
    Form {
      Section("Configured Hosts") {
        if store.remoteHosts.isEmpty {
          ContentUnavailableView(
            "No Hosts",
            systemImage: "server.rack",
            description: Text("Add a machine that you can reach with SSH.")
          )
        } else {
          ForEach(store.remoteHosts) { host in
            HStack(spacing: 12) {
              VStack(alignment: .leading, spacing: 3) {
                Text(host.id)
                  .font(.body.weight(.medium))
                Text(host.destination)
                  .font(.callout.monospaced())
                  .foregroundStyle(.secondary)
              }
              Spacer()
              Button(role: .destructive) {
                _ = store.send(.remoteHostRemoved(host.id))
              } label: {
                Image(systemName: "trash")
              }
              .buttonStyle(.borderless)
              .accessibilityLabel("Remove \(host.id)")
            }
          }
        }
      }

      Section {
        TextField("Name", text: $name)
          .accessibilityIdentifier("settings.hosts.name")
        TextField("SSH destination, such as user@example.com", text: $destination)
          .accessibilityIdentifier("settings.hosts.destination")
        LabeledContent("Host ID") {
          Text(draft.id.isEmpty ? "—" : draft.id)
            .font(.callout.monospaced())
            .foregroundStyle(.secondary)
        }
        LabeledContent("SSH Arguments") {
          TextEditor(text: $sshArguments)
            .font(.callout.monospaced())
            .frame(height: 72)
            .overlay {
              RoundedRectangle(cornerRadius: 6)
                .stroke(.separator)
            }
            .accessibilityIdentifier("settings.hosts.ssh-arguments")
        }
        Button("Add Host") {
          _ = store.send(.remoteHostAdded(draft))
          name = ""
          destination = ""
          sshArguments = ""
        }
        .disabled(!canAdd)
        .accessibilityIdentifier("settings.hosts.add")
      } header: {
        Text("Add Host")
      } footer: {
        Text("Enter one SSH argument per line. Supaterm installs its session host after the first connection.")
      }
    }
    .navigationTitle("Hosts")
    .settingsFormLayout()
  }
}
