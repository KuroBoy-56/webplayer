import Foundation

/**
 * Copia del catálogo en el equipo (Caches): el inicio se ve al instante y el servidor se consulta
 * en segundo plano cuando la copia tiene más de 4 horas. Una copia por línea (usuario@servidor).
 */
enum CatalogCache {
    static let maxAge: Double = 4 * 3600

    private struct Blob: Codable { let cats: [Category]; let items: [Item] }

    private static var dir: URL {
        let d = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("catalog", isDirectory: true)
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }

    private static func file(_ s: Session, _ kind: Kind) -> URL {
        // nombre por huella: nunca el usuario ni la contraseña en el archivo
        var h: UInt64 = 1469598103934665603
        for b in "\(s.user)@\(s.base)".utf8 { h = (h ^ UInt64(b)) &* 1099511628211 }
        return dir.appendingPathComponent("\(String(h, radix: 16))_\(kind.rawValue).json")
    }

    static func load(_ s: Session, _ kind: Kind) -> ([Category], [Item])? {
        guard let d = try? Data(contentsOf: file(s, kind)), let b = try? JSONDecoder().decode(Blob.self, from: d), !b.items.isEmpty else { return nil }
        return (b.cats, b.items)
    }

    static func save(_ s: Session, _ kind: Kind, _ cats: [Category], _ items: [Item]) {
        guard !items.isEmpty, let d = try? JSONEncoder().encode(Blob(cats: cats, items: items)) else { return }
        try? d.write(to: file(s, kind), options: .atomic)
    }

    static func isStale(_ s: Session, _ kind: Kind) -> Bool {
        guard let a = try? FileManager.default.attributesOfItem(atPath: file(s, kind).path), let m = a[.modificationDate] as? Date else { return true }
        return Date().timeIntervalSince(m) > maxAge
    }

    static func clear() { try? FileManager.default.removeItem(at: dir) }
}
