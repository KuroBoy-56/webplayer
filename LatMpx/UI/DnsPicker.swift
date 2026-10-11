import SwiftUI

/** Botón "DNS: …" que abre la lista de DNS seguros (igual que Android). */
struct DnsButton: View {
    var fill = false
    @State private var open = false
    @State private var current = SecureDns.current

    var body: some View {
        Button { open = true } label: {
            HStack(spacing: 6) {
                Image(systemName: "server.rack").font(.system(size: 15, weight: .semibold))
                Text("DNS: \(current.label)").font(.system(size: 14, weight: .bold)).lineLimit(1).minimumScaleFactor(0.8)
            }
            .foregroundColor(.white)
            .padding(.horizontal, 14).frame(maxWidth: fill ? .infinity : nil, minHeight: 48)
            .background(Color(hex: 0x6D6D6E, alpha: 0.5))
            .clipShape(RoundedRectangle(cornerRadius: 6))
        }
        .buttonStyle(.plain)
        .sheet(isPresented: $open, onDismiss: { current = SecureDns.current }) { DnsSheet() }
    }
}

struct DnsSheet: View {
    @Environment(\.dismiss) private var dismiss
    @State private var sel = SecureDns.current.key

    var body: some View {
        NavigationStack {
            List {
                Section {
                    ForEach(SecureDns.options) { o in
                        Button {
                            SecureDns.select(o.key)
                            Xtream.clearCache()
                            sel = o.key
                            dismiss()
                        } label: {
                            HStack {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(o.label).font(.system(size: 16, weight: o.key == sel ? .bold : .regular)).foregroundColor(.white)
                                    Text(o.note).font(.system(size: 12)).foregroundColor(Theme.muted)
                                }
                                Spacer()
                                if o.key == sel { Image(systemName: "checkmark").foregroundColor(Theme.accent) }
                            }.contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .listRowBackground(Color(hex: 0x1F1F1F))
                    }
                } footer: {
                    Text("Cambia el DNS si algún canal o servidor no abre en tu red. Se aplica a los servidores IPTV y al video.")
                        .foregroundColor(Theme.muted)
                }
            }
            .scrollContentBackground(.hidden)
            .background(Color(hex: 0x141414).ignoresSafeArea())
            .navigationTitle("DNS").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cerrar") { dismiss() } } }
        }
        .presentationDetents([.large])
        .preferredColorScheme(.dark)
    }
}
