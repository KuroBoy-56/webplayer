import Foundation

/**
 * Índice compartido entre los equipos (api/vidx.php del panel; el mismo que leen y dejan Roku, Vega, Android, webOS,
 * Tizen y la web). En un MP4 con el índice (moov) al final, AVPlayer lee el principio del archivo, pide el moov
 * (3-10 MB del final: 15-35 s con servidores lentos o líneas de una conexión) y vuelve al principio del video. Si otro
 * equipo ya lo dejó en la VPS del dueño o en la VDS propia del distribuidor, StreamLoader le contesta ese pedido desde
 * aquí y al servidor IPTV solo se le pide el video. Si no lo tiene, el moov que llega del servidor IPTV se le deja
 * (después de arrancar). Sin VPS / VDS el panel dice que no y todo sigue igual. Solo películas y capítulos MP4.
 */
final class SharedIndex {
    static let shared = SharedIndex()
    /** contenido del moov (16 MB en base64, el tope de la VPS / VDS) */
    static let maxBody = 12 * 1_048_576
    private static let part = 1_536_000
    private static let vod = try? NSRegularExpression(pattern: "/(movie|series)/[^/]+/[^/]+/\\d+\\.(mp4|m4v|mov)(\\?|$)", options: [.caseInsensitive])

    final class Entry {
        let url: String
        fileprivate var headDone = false
        fileprivate var bodyDone = false
        fileprivate var size: Int64 = 0          // tamaño del archivo con que se guardó
        fileprivate var textLen = 0
        fileprivate var box: Data?               // la caja moov entera (cabecera + contenido)
        fileprivate var missing = false          // la máquina dijo que no lo tiene: este equipo lo deja
        fileprivate var up = ""                  // enlace firmado para bajarlo / subirlo
        fileprivate var sent = false
        fileprivate var waiters: [() -> Void] = []
        init(url: String) { self.url = url }
    }

    /** .server: se pide al servidor IPTV como siempre */
    enum Answer { case server, wait, box(Data, Int64) }

    private let q = DispatchQueue(label: "mpx.sharedindex")
    private var entries: [String: Entry] = [:]
    private var order: [String] = []

    /** la entrada del video (y la consulta al panel la primera vez); nil si no es una película o capítulo MP4 */
    func entry(_ url: URL) -> Entry? {
        let s = url.absoluteString
        guard let re = Self.vod, re.firstMatch(in: s, range: NSRange(s.startIndex..., in: s)) != nil else { return nil }
        let key = s.replacingOccurrences(of: "^https?://", with: "", options: [.regularExpression, .caseInsensitive])
        return q.sync {
            if let e = entries[key] { return e }
            let e = Entry(url: s)
            entries[key] = e
            order.append(key)
            // los dos últimos videos (el moov pesa varios MB)
            while order.count > 2 { entries.removeValue(forKey: order.removeFirst()) }
            Task.detached { await self.fetch(e) }
            return e
        }
    }

    /** dónde empieza el moov de [bodyLen] bytes si es la última caja del archivo */
    static func moovAt(_ fileSize: Int64, _ bodyLen: Int) -> Int64 { fileSize - 8 - Int64(bodyLen) }

    /** la caja moov entera: cabecera de 8 bytes (tamaño y «moov») + contenido */
    static func box(_ body: Data) -> Data {
        let n = UInt32(body.count + 8)
        var d = Data([UInt8(n >> 24 & 0xFF), UInt8(n >> 16 & 0xFF), UInt8(n >> 8 & 0xFF), UInt8(n & 0xFF), 0x6D, 0x6F, 0x6F, 0x76])
        d.append(body)
        return d
    }

    /**
     * ¿El pedido de AVPlayer desde [from] es el moov guardado? .wait: el panel o la VPS / VDS todavía no contestaron
     * (StreamLoader espera como mucho 8 s); .box: la caja y dónde empieza en el archivo; .server: se pide al servidor
     */
    func answer(_ e: Entry, from: Int64, fileSize: Int64) -> Answer {
        q.sync {
            if !e.headDone { return .wait }
            // con solo el largo del texto base64: el moov empieza en ese punto (± 2 bytes de relleno) o más adelante
            guard e.size > 0, from >= Self.moovAt(e.size, e.textLen / 4 * 3) - 2 else { return .server }
            if !e.bodyDone { return .wait }
            guard let b = e.box else { return .server }
            // otro tamaño en el servidor (el archivo cambió): no sirve, y este equipo deja el índice nuevo
            if fileSize != e.size {
                e.box = nil
                e.missing = true
                return .server
            }
            let at = e.size - Int64(b.count)
            return from >= at ? .box(b, at) : .server
        }
    }

    /** [cb] en [queue] cuando cambia lo que se sabe (el panel / la VPS contestaron, llegó el moov), o a los [timeout] s */
    func whenReady(_ e: Entry, timeout: Double, on queue: DispatchQueue, _ cb: @escaping () -> Void) {
        // (las dos salidas corren en [queue], de a una: cb una sola vez)
        var fired = false
        let once = { queue.async { if !fired { fired = true; cb() } } }
        q.sync { if e.bodyDone { once() } else { e.waiters.append(once) } }
        queue.asyncAfter(deadline: .now() + max(0, timeout)) { if !fired { fired = true; cb() } }
    }

    /** ¿hay que copiar el moov que llega del servidor para dejárselo a la VPS / VDS? */
    func wantsCopy(_ e: Entry) -> Bool { q.sync { e.missing && !e.sent && !e.up.isEmpty } }

    /** el moov leído del servidor IPTV, a la VPS / VDS: una vez, de a partes y después de que el video ya empezó */
    func share(_ e: Entry, body: Data, fileSize: Int64) {
        let go: Bool = q.sync {
            if e.sent || fileSize <= 0 || !e.missing || e.up.isEmpty { return false }
            e.sent = true
            return true
        }
        guard go else { return }
        let up = q.sync { e.up }
        Task.detached {
            try? await Task.sleep(nanoseconds: 8_000_000_000)
            let text = body.base64EncodedString()
            let chars = Array(text.utf8)
            let n = (chars.count + SharedIndex.part - 1) / SharedIndex.part
            if n > 12 { return }
            for i in 0..<n {
                let piece = String(decoding: chars[(i * SharedIndex.part)..<min(chars.count, (i + 1) * SharedIndex.part)], as: UTF8.self)
                let j = await Net.postJson(up, ["kind": "m", "size": fileSize, "len": chars.count, "i": i, "n": n, "part": piece]).json()
                // no lo aceptó, o ya lo tiene (otro equipo lo dejó mientras tanto)
                guard let j = j, j.b("ok"), !j.b("have"), !j.b("saved") else { return }
                try? await Task.sleep(nanoseconds: 400_000_000)
            }
        }
    }

    /* ---------- panel y VPS / VDS ---------- */

    private func fetch(_ e: Entry) async {
        var size: Int64 = 0, textLen = 0, box: Data?, missing = false, up = ""
        defer {
            q.sync {
                e.size = size; e.textLen = textLen; e.box = box; e.missing = missing; e.up = up
                e.headDone = true; e.bodyDone = true
                let w = e.waiters
                e.waiters = []
                w.forEach { $0() }
            }
        }
        guard let r = await Cloud.shared.call({ t in
            await Net.get(PanelUrl.api("vidx.php") + "?token=" + urlEnc(t) + "&u=" + PanelImg.b64u(e.url), timeout: 4)
        }), let j = r.json(), j.b("ok") else { return }
        let head = j.s("head")
        up = j.s("url")
        if head.isEmpty || up.isEmpty { return }
        guard let h = await Net.get(head, timeout: 3).json() else { return }
        if !h.b("ok") {
            // {"ok": false}: no lo tiene
            missing = h["ok"] != nil
            return
        }
        let len = h.i("len")
        guard h.s("kind") == "m", len > 0, len <= Self.maxBody / 3 * 4 + 4 else { return }
        size = Int64(h.s("size")) ?? 0
        textLen = len
        // ya se sabe dónde estaría el moov: los pedidos que no lo son dejan de esperar
        q.sync {
            e.size = size; e.textLen = textLen; e.headDone = true
            let w = e.waiters
            e.waiters = []
            w.forEach { $0() }
        }
        let b = await Net.get(up, timeout: 25)
        guard b.ok, let nl = b.data.firstIndex(of: 0x0A), nl - b.data.startIndex <= 80 else { return }
        let line = String(decoding: b.data[b.data.startIndex..<nl], as: UTF8.self).split(separator: " ")
        let text = b.data[(nl + 1)...]
        guard line.count == 4, line[0] == "VIDX1", line[1] == "m", Int64(line[2]) == size, Int(line[3]) == text.count,
              let body = Data(base64Encoded: Data(text)), body.count >= 16 else { return }
        box = Self.box(body)
    }
}

/**
 * Copia el moov que AVPlayer lee del servidor IPTV: una lectura que empieza en una caja «moov» de hasta
 * [SharedIndex.maxBody]. Devuelve su contenido (sin cabecera) la vez que se termina de leer; cualquier otra cosa la
 * deja de mirar ([dead]).
 */
struct MoovCapture {
    private var head = Data()
    private var body = Data()
    private var want = 0
    private(set) var dead = false
    /** posición del archivo donde sigue (para seguir con el pedido siguiente si AVPlayer lo cortó) */
    private(set) var next: Int64

    init(at: Int64) { next = at }

    mutating func feed(_ chunk: Data) -> Data? {
        if dead { return nil }
        next += Int64(chunk.count)
        var rest = chunk[...]
        if head.count < 8 {
            let k = min(8 - head.count, rest.count)
            head.append(rest.prefix(k))
            rest = rest.dropFirst(k)
            if head.count < 8 { return nil }
            let b = [UInt8](head)
            let size = Int(b[0]) << 24 | Int(b[1]) << 16 | Int(b[2]) << 8 | Int(b[3])
            // (tamaño 0 = hasta el final y 1 = tamaño de 64 bits: no se copian)
            guard b[4] == 0x6D, b[5] == 0x6F, b[6] == 0x6F, b[7] == 0x76, size >= 16, size - 8 <= SharedIndex.maxBody else {
                dead = true
                return nil
            }
            want = size - 8
            body.reserveCapacity(want)
        }
        body.append(rest.prefix(want - body.count))
        if body.count < want { return nil }
        dead = true
        return body
    }
}
