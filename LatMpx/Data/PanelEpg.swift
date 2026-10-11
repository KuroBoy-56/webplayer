import Foundation

/**
 * Guía de respaldo del panel (api/epg.php) para canales sin get_short_epg.
 * Se pide en lotes (hasta 400 canales) igual que la web y se guarda en memoria.
 */
actor PanelEpg {
    static let shared = PanelEpg()
    private let maxBatch = 400
    private var cache: [Int: [EpgEntry]] = [:]
    private var failedAt: Double = 0

    private func current(_ l: [EpgEntry]) -> [EpgEntry] {
        let now = Date().timeIntervalSince1970
        return Array(l.filter { $0.end > now }.prefix(8))
    }

    func cached(_ id: Int) -> [EpgEntry]? { cache[id].map(current) }

    /** Guía del canal; en la misma consulta se piden los vecinos que aún no se consultaron. */
    func guide(_ ch: Item, neighbors: [Item]) async -> [EpgEntry] {
        if let c = cache[ch.id] { return current(c) }
        if Date().timeIntervalSince1970 - failedAt < 60 { return [] }
        var seen = Set<Int>()
        let pending = ([ch] + neighbors).filter { seen.insert($0.id).inserted && cache[$0.id] == nil }.prefix(maxBatch)
        let arr: [JObj] = pending.map { ["id": String($0.id), "epg": $0.epgId, "name": $0.name] }
        let r = await Cloud.shared.call { t in await Net.postJson(PanelUrl.api("epg.php"), ["token": t, "channels": arr]) }
        guard let r = r, r.ok else { failedAt = Date().timeIntervalSince1970; return [] }
        let epg = r.json()?.o("epg")
        for c in pending {
            let list = ((epg?[String(c.id)] as? [Any]) ?? []).compactMap { $0 as? JObj }.compactMap { e -> EpgEntry? in
                let s = e.d("s"), en = e.d("e")
                return s > 0 && en > 0 ? EpgEntry(title: e.s("t"), desc: e.s("d"), start: s, end: en) : nil
            }.sorted { $0.start < $1.start }
            cache[c.id] = list
        }
        return current(cache[ch.id] ?? [])
    }

    func clear() { cache = [:]; failedAt = 0 }
}
