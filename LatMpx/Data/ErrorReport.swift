import Foundation
#if canImport(UIKit)
import UIKit
#endif

/**
 * Errores de la app al panel (api/report.php, cifrado como login.php): el dueño los ve en
 * «Errores de las apps». Nunca se manda la contraseña de la línea.
 */
enum ErrorReport {
    private static let lock = NSLock()
    private static var recent: [String: Double] = [:]
    private static var crashFile: URL { FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("pending_crash.json") }

    static func boot() {
        try? FileManager.default.createDirectory(at: crashFile.deletingLastPathComponent(), withIntermediateDirectories: true)
        #if os(iOS)
        NSSetUncaughtExceptionHandler { e in
            let body = ErrorReport.base("crash", "\(e.name.rawValue): \(e.reason ?? "")", e.callStackSymbols.joined(separator: "\n"), "")
            try? Data(Json.string(body).utf8).write(to: ErrorReport.crashFile)
        }
        #endif
        // el cierre de la vez anterior
        if let d = try? Data(contentsOf: crashFile), let o = Json.parse(d) as? JObj {
            try? FileManager.default.removeItem(at: crashFile)
            Task.detached { await send(o) }
        }
    }

    /** kind: crash | error | playback | network | panel | warning */
    static func report(_ kind: String, _ message: String, detail: String = "", screen: String = "") {
        if message.trimmed.isEmpty { return }
        let key = "\(kind)|\(message)"
        let now = Date().timeIntervalSince1970
        lock.lock()
        if (recent[key] ?? 0) > now - 60 { lock.unlock(); return }
        recent[key] = now
        lock.unlock()
        let body = base(kind, String(message.prefix(400)), String(detail.prefix(8000)), screen)
        Task.detached { await send(body) }
    }

    static func base(_ kind: String, _ message: String, _ detail: String, _ screen: String) -> JObj {
        let s = Store.session()
        let ver = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1.0"
        var os = "iOS"
        #if canImport(UIKit)
        os = "\(UIDevice.current.systemName) \(UIDevice.current.systemVersion)"
        #endif
        var o: JObj = ["app": Tenant.app, "version": ver, "kind": kind, "message": message, "detail": detail, "screen": screen,
                       "device": Device.id, "model": Device.model, "os": os, "user": s?.user ?? "", "server": s?.base ?? ""]
        if !Tenant.code.isEmpty { o["tenant"] = Tenant.code }
        return o
    }

    private static func send(_ o: JObj) async {
        guard PanelCrypto.hasKey, let data = try? PanelCrypto.encrypt(Json.string(o)) else { return }
        _ = await Net.postForm(PanelUrl.api("report.php"), ["data": data])
    }
}
