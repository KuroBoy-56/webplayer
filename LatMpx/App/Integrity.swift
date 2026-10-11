import Foundation
import MachO
import CryptoKit

/**
 * Comprobación de integridad (equivalente a la de la firma del APK en Android): al compilar el .ipa,
 * tools/seal.py guarda en ic.bin el SHA-256 del código de la app. Al abrir se calcula lo mismo sobre el
 * código cargado; si no coincide (copia modificada), se avisa al panel y la app se cierra. Volver a
 * firmar con Sideloadly o AltStore no cambia el código, así que la app del cliente siempre pasa.
 * Solo en la versión publicada en un equipo real (no en Debug ni en el simulador).
 */
enum Integrity {
    private static let mask: [UInt8] = [0xC3, 0x78, 0xC5, 0x82, 0x47, 0x0B, 0xFC, 0xCD, 0x24, 0x79, 0xAE, 0x70, 0x54, 0xBB, 0x26, 0x69,
                                        0x60, 0xE0, 0x4B, 0xE6, 0x72, 0x68, 0xC3, 0x6C, 0x92, 0x0C, 0xD2, 0xA6, 0x8F, 0x49, 0xF5, 0xE2]

    static func check() {
        #if !DEBUG && !targetEnvironment(simulator)
        guard let url = Bundle.main.url(forResource: "ic", withExtension: "bin"), let seal = try? Data(contentsOf: url), seal.count == 32 else {
            // compilada a mano sin el sello (no viene de GitHub Actions): solo se avisa
            ErrorReport.report("security", "Versión sin sello de integridad", screen: "inicio")
            return
        }
        // si no se puede leer el código no se cierra nada (nunca dejar al cliente fuera por un fallo propio)
        guard let code = mainCode() else { return }
        let digest = Array(SHA256.hash(data: code))
        let expected = zip(Array(seal), mask).map { $0 ^ $1 }
        if digest != expected {
            ErrorReport.report("security", "App modificada: el código no coincide con la versión original", screen: "inicio")
            DispatchQueue.main.asyncAfter(deadline: .now() + 2.5) { exit(0) }
        }
        #endif
    }

    /** la sección __TEXT,__text del ejecutable de la app tal como está cargada */
    private static func mainCode() -> Data? {
        let exe = Bundle.main.executableURL?.lastPathComponent ?? ""
        guard !exe.isEmpty else { return nil }
        for i in 0..<_dyld_image_count() {
            guard let name = _dyld_get_image_name(i), let header = _dyld_get_image_header(i) else { continue }
            let path = String(cString: name)
            guard path.hasSuffix(".app/" + exe) else { continue }
            var size: UInt = 0
            let ptr = header.withMemoryRebound(to: mach_header_64.self, capacity: 1) { getsectiondata($0, "__TEXT", "__text", &size) }
            guard let p = ptr, size > 0 else { return nil }
            return Data(bytes: p, count: Int(size))
        }
        return nil
    }
}
