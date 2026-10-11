import Foundation
import Combine

/**
 * Continuar viendo y favoritos guardados en el panel (api/progress.php), por usuario IPTV.
 * Se pide un token una vez con usuario + contraseña; después solo se usa el token.
 * Mismo formato que la web y Android: películas por nombre (type "movie"), series una entrada por serie (type "episode").
 */
final class Cloud: ObservableObject {
    static let shared = Cloud()
    /** cambia cada vez que llegan o se modifican datos (la interfaz lo observa) */
    @Published private(set) var rev = 0

    private let lock = NSLock()
    private var progress: [String: Progress] = [:]   // por título (clave del panel)
    private var favOrder: [String] = []             // claves "movie:12", la más nueva primero
    private var favs: [String: Item] = [:]
    private var lastSent: [String: Double] = [:]

    private func bump() { DispatchQueue.main.async { self.rev += 1 } }
    private var api: String { PanelUrl.api("progress.php") }

    /* ---------- token ---------- */
    private func token(_ s: Session) async -> String? {
        if let t = Store.cloudToken, !t.isEmpty { return t }
        var body: JObj = ["action": "auth", "user": s.user, "pass": s.pass, "dns": s.base, "platform": Tenant.app, "device": Device.id]
        Tenant.tag(&body)
        let j = await Net.postJson(api, body).json()
        _ = Tenant.onPanelError(j)
        rememberTmdbKey(j)
        let t = j?.s("token") ?? ""
        if t.isEmpty { return nil }
        Store.cloudToken = t
        return t
    }

    /** Llama a un endpoint del panel con el token; si venció, pide otro una vez. */
    func call(_ block: (String) async -> Resp) async -> Resp? {
        guard let s = Store.session(), var tok = await token(s) else { return nil }
        var r = await block(tok)
        if r.code == 401 {
            Store.cloudToken = nil
            guard let t2 = await token(s) else { return nil }
            tok = t2
            r = await block(tok)
        }
        let j = r.json()
        if r.code == 403 || r.code == 404 { _ = Tenant.onPanelError(j) }
        if let t = j?.s("token"), !t.isEmpty { Store.cloudToken = t }
        rememberTmdbKey(j)
        return r
    }

    private func rememberTmdbKey(_ j: JObj?) {
        let k = j?.s("tmdbKey") ?? ""
        if !k.isEmpty && k != "missing_tmdb_key" && k != Store.tmdbKey { Store.tmdbKey = k }
    }

    /* ---------- carga ---------- */
    func load() async {
        guard let r = await call({ t in await Net.get(self.api + "?v=2&token=" + urlEnc(t)) }), let j = r.json() else { return }
        var pm: [String: Progress] = [:]
        if let po = j.o("progress") {
            for (title, v) in po { if let o = v as? JObj, let p = parseProgress(title, o) { pm[title] = p } }
        }
        let fl = j.objs("favorites").compactMap { o -> (Item, String)? in parseFav(o).map { ($0, o.s("addedAt")) } }.sorted { $0.1 > $1.1 }
        apply(pm, fl.map { $0.0 })
    }

    private func apply(_ pm: [String: Progress], _ fl: [Item]) {
        lock.lock()
        progress = pm
        favs = [:]; favOrder = []
        for it in fl where favs[it.key] == nil { favs[it.key] = it; favOrder.append(it.key) }
        lock.unlock()
        bump()
    }

    func clear() {
        lock.lock(); progress = [:]; favs = [:]; favOrder = []; lastSent = [:]; lock.unlock()
        bump()
    }

    private static let iso: ISO8601DateFormatter = { ISO8601DateFormatter() }()

    private func parseProgress(_ title: String, _ o: JObj) -> Progress? {
        let id = o.s("id").filter { $0.isNumber }
        let sid = o.s("seriesId").filter { $0.isNumber }
        let key: String
        switch o.s("type") {
        case "movie":
            guard !id.isEmpty else { return nil }
            key = "movie:\(id)"
        case "episode", "series":
            if !sid.isEmpty && !id.isEmpty { key = "series:\(sid):\(id)" }
            else if !sid.isEmpty { key = "series:\(sid)" }
            else if !id.isEmpty { key = "series:\(id)" }
            else { return nil }
        default: return nil
        }
        return Progress(key: key, title: title, label: title, poster: o.s("poster"),
                        position: Int64(o.d("position") * 1000), duration: Int64(o.d("duration") * 1000),
                        updated: Cloud.iso.date(from: o.s("updatedAt"))?.timeIntervalSince1970 ?? 0,
                        url: o.s("url"), categoryId: o.s("categoryId"))
    }

    private func parseFav(_ o: JObj) -> Item? {
        guard let id = Int(o.s("id")) else { return nil }
        let k: Kind
        switch o.s("type") { case "movie": k = .movie; case "series": k = .series; case "live": k = .live; default: return nil }
        return Item(id: id, name: o.s("title"), poster: o.s("poster"), kind: k, categoryId: o.s("categoryId"))
    }

    /* ---------- continuar viendo ---------- */
    func progress(_ key: String) -> Progress? { lock.lock(); defer { lock.unlock() }; return progress.values.first { $0.key == key } }

    func seriesProgress(_ seriesId: Int) -> Progress? {
        lock.lock(); defer { lock.unlock() }
        return progress.values.filter { $0.key == "series:\(seriesId)" || $0.key.hasPrefix("series:\(seriesId):") }.max { $0.updated < $1.updated }
    }

    func progressList() -> [Progress] {
        lock.lock(); defer { lock.unlock() }
        return Array(progress.values.filter { $0.position > 0 }.sorted { $0.updated > $1.updated }.prefix(30))
    }

    /** Guarda la posición; al panel como máximo cada 30 s por título salvo con force. Al 95 % se borra. */
    func saveProgress(_ p: Progress, force: Bool = false) {
        let parts = p.key.split(separator: ":").map(String.init)
        let isSeries = parts.first == "series"
        let done = p.duration > 0 && Double(p.position) >= Double(p.duration) * 0.95
        let now = Date().timeIntervalSince1970
        lock.lock()
        let stale = progress.values.filter { $0.title != p.title && sameMedia($0.key, p.key) }.map { $0.title }
        stale.forEach { progress.removeValue(forKey: $0) }
        progress.removeValue(forKey: p.title)
        if !done { var c = p; c.updated = now; progress[p.title] = c }
        let go = done || force || now - (lastSent[p.title] ?? 0) >= 30
        if go { lastSent[p.title] = now }
        lock.unlock()
        stale.forEach { deleteRemote($0) }
        bump()
        if !go { return }
        if done { deleteRemote(p.title); return }
        post(["action": "save", "title": p.title, "position": Double(p.position) / 1000, "duration": Double(p.duration) / 1000,
              "url": p.url, "poster": p.poster, "type": isSeries ? "episode" : "movie",
              "id": isSeries ? (parts.count > 2 ? parts[2] : "") : (parts.count > 1 ? parts[1] : ""),
              "seriesId": isSeries && parts.count > 1 ? parts[1] : "", "categoryId": p.categoryId,
              "platform": Tenant.app, "device": Device.id])
    }

    private func sameMedia(_ a: String, _ b: String) -> Bool {
        let pa = a.split(separator: ":"), pb = b.split(separator: ":")
        return pa.count >= 2 && pb.count >= 2 && pa[0] == pb[0] && pa[1] == pb[1]
    }

    private func deleteRemote(_ title: String) { post(["action": "delete", "title": title]) }

    private func post(_ body: JObj) {
        let api = self.api
        Task.detached { _ = await self.call { t in var b = body; b["token"] = t; return await Net.postJson(api, b) } }
    }

    /* ---------- favoritos ---------- */
    func isFav(_ key: String) -> Bool { lock.lock(); defer { lock.unlock() }; return favs[key] != nil }

    func favList(_ kind: Kind? = nil) -> [Item] {
        lock.lock(); defer { lock.unlock() }
        return favOrder.compactMap { favs[$0] }.filter { kind == nil || $0.kind == kind }
    }

    /** Agrega o quita; devuelve true si quedó en favoritos. */
    @discardableResult
    func toggleFav(_ item: Item) -> Bool {
        lock.lock()
        let on: Bool
        if favs[item.key] != nil {
            favs.removeValue(forKey: item.key); favOrder.removeAll { $0 == item.key }; on = false
        } else {
            favs[item.key] = item; favOrder.insert(item.key, at: 0); on = true
        }
        lock.unlock()
        bump()
        if on {
            post(["action": "fav_add", "item": ["id": String(item.id), "type": item.kind.rawValue, "title": item.name, "poster": item.poster, "categoryId": item.categoryId]])
        } else {
            post(["action": "fav_remove", "id": String(item.id), "type": item.kind.rawValue])
        }
        return on
    }
}
