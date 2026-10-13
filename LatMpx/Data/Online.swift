import Foundation
import Network

/** ¿Hay red con salida a internet? (sin red: el inicio de sesión ofrece Mis descargas) */
final class Online: ObservableObject {
    static let shared = Online()
    @Published private(set) var connected = true
    private let monitor = NWPathMonitor()

    private init() {
        monitor.pathUpdateHandler = { [weak self] path in
            let ok = path.status == .satisfied
            DispatchQueue.main.async { self?.connected = ok }
        }
        monitor.start(queue: DispatchQueue(label: "online"))
    }
}
