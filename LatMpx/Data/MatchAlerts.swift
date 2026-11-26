import Foundation
import UserNotifications
import BackgroundTasks

/** equipo favorito, en el formato de la nube (api/alerts.php): n = nombre de TheSportsDB, l = en pantalla, b = escudo, lg = liga, sp = deporte */
struct FavTeam: Hashable {
    let n: String, l: String, b: String, lg: String, sp: String
    var name: String { l.isEmpty ? n : l }
    var json: JObj { ["n": n, "l": l, "b": b, "lg": lg, "sp": sp] }
}

/**
 * Avisos de los partidos de los equipos favoritos (como Android): 30 minutos antes, 10 minutos antes y al empezar, con
 * notificaciones locales del iPhone (llegan con la app cerrada y no necesitan servidor de push). Los equipos y los
 * partidos marcados en otro equipo (celular, TV, computadora) se guardan en la nube del panel (api/alerts.php, por
 * línea): el panel solo lo habilita con los perfiles encendidos para iOS y nunca en una demo. Los partidos salen de los
 * próximos 21 días del panel (api/sports_fixtures.php), nunca de TheSportsDB. iOS guarda como mucho 64 avisos
 * pendientes: se programan los primeros 60. Se vuelve a programar al abrir la app, al volver a ella, al cambiar los
 * equipos y, con la app cerrada, cuando iOS deja actualizar en segundo plano (BGAppRefreshTask, más o menos cada hora).
 */
final class MatchAlerts: ObservableObject {
    static let shared = MatchAlerts()
    /** el mismo identificador va en BGTaskSchedulerPermittedIdentifiers (project.yml) */
    static let refreshId = "com.latmpx.player.matchrefresh"
    private static let prefix = "ma|"
    private static let maxPending = 60

    /** el panel guarda equipos para esta línea (perfiles encendidos para iOS y no es una demo) */
    @Published private(set) var enabled = false
    @Published private(set) var teams: [FavTeam] = []
    /** permiso de notificaciones del iPhone: nil = todavía no se preguntó */
    @Published private(set) var permission: Bool?
    /** partidos marcados en otro equipo (solo se toca en el hilo principal) */
    private var marked: [String: JObj] = [:]

    private var api: String { PanelUrl.api("alerts.php") }

    /** lo que dice la nube; false = sin avisos para esta línea o sin respuesta */
    private func apply(_ j: JObj?) async -> Bool {
        guard let j = j, j.b("success") else { return false }
        let on = j.b("enabled")
        let list = on ? j.objs("teams").compactMap { x -> FavTeam? in
            x.s("n").isEmpty ? nil : FavTeam(n: x.s("n"), l: x.s("l"), b: x.s("b"), lg: x.s("lg"), sp: x.s("sp"))
        } : []
        var ev = [String: JObj]()
        for (k, v) in (on ? j.o("events") : nil) ?? [:] { if let o = v as? JObj { ev[k] = o } }
        await MainActor.run { self.marked = ev; self.enabled = on; self.teams = list }
        return on
    }

    /** baja de la nube los equipos y los partidos marcados */
    @discardableResult
    func sync() async -> Bool {
        guard Store.session() != nil else { return false }
        let r = await Cloud.shared.call { t in await Net.get(self.api + "?token=" + urlEnc(t), timeout: 15) }
        return await apply(r?.json())
    }

    /** reemplaza los equipos en la nube (el celular, la TV y la computadora de la misma línea los ven) y reprograma */
    func setTeams(_ list: [FavTeam]) async -> Bool {
        let body: JObj = ["action": "set_teams", "teams": list.map { $0.json }]
        let r = await Cloud.shared.call { t in
            var b = body
            b["token"] = t
            return await Net.postJson(self.api, b)
        }
        let ok = await apply(r?.json())
        if ok { await reschedule() }
        return ok
    }

    /** pide el permiso de notificaciones (el cuadro de iOS sale una sola vez; después, solo desde Ajustes) */
    func requestPermission() async -> Bool {
        let ok = (try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])) ?? false
        await MainActor.run { self.permission = ok }
        if ok { await reschedule() }
        return ok
    }

    func refreshPermission() async {
        let st = await UNUserNotificationCenter.current().notificationSettings().authorizationStatus
        let p: Bool? = st == .notDetermined ? nil : (st == .authorized || st == .provisional || st == .ephemeral)
        await MainActor.run { self.permission = p }
    }

    /** al abrir la app o volver a ella: nube y avisos al día */
    func refresh() async {
        await refreshPermission()
        if await sync() { await reschedule() }
    }

    /** sesión cerrada: sin avisos ni equipos */
    func clear() {
        let c = UNUserNotificationCenter.current()
        c.getPendingNotificationRequests { reqs in
            c.removePendingNotificationRequests(withIdentifiers: reqs.map { $0.identifier }.filter { $0.hasPrefix(MatchAlerts.prefix) })
        }
        DispatchQueue.main.async { self.marked = [:]; self.enabled = false; self.teams = [] }
    }

    static func title(_ e: SportEvent) -> String {
        let h = e.homeLabel.isEmpty ? e.home : e.homeLabel, a = e.awayLabel.isEmpty ? e.away : e.awayLabel
        if !h.isEmpty && !a.isEmpty { return "\(h) vs \(a)" }
        return e.title.isEmpty ? e.league : e.title
    }

    /** programa los avisos de los partidos de los equipos favoritos (21 días) y de los marcados, los más cercanos primero */
    func reschedule() async {
        let c = UNUserNotificationCenter.current()
        let old = await c.pendingNotificationRequests().map { $0.identifier }.filter { $0.hasPrefix(Self.prefix) }
        c.removePendingNotificationRequests(withIdentifiers: old)
        let st = await c.notificationSettings().authorizationStatus
        guard st == .authorized || st == .provisional || st == .ephemeral else { return }
        let (on, names, marks) = await MainActor.run { (self.enabled, Set(self.teams.map { $0.n }), self.marked) }
        guard on, !names.isEmpty || !marks.isEmpty else { return }
        var list: [(id: String, title: String, start: Double)] = []
        var seen = Set<String>()
        if !names.isEmpty, let fx = await SportsPanel.fixtures(0).fx {
            for e in fx.events where !e.postponed && (names.contains(e.home) || names.contains(e.away)) {
                if seen.insert(e.id).inserted { list.append((e.id, Self.title(e), e.start)) }
            }
        }
        for (id, o) in marks {
            // la nube guarda el inicio en milisegundos
            let raw = Double(o.s("s")) ?? 0
            if raw > 0 && seen.insert(id).inserted { list.append((id, o.s("t"), raw > 1e11 ? raw / 1000 : raw)) }
        }
        let now = Date().timeIntervalSince1970
        var n = 0
        for x in list.sorted(by: { $0.start < $1.start }) {
            for stage in [30, 10, 0] {
                let at = x.start - Double(stage * 60)
                if at <= now + 5 || n >= Self.maxPending { continue }
                let content = UNMutableNotificationContent()
                content.title = x.title
                content.body = stage == 30 ? tr("El partido empieza en 30 minutos") : stage == 10 ? tr("Está por comenzar: faltan 10 minutos") : tr("¡Ya comenzó! El partido está en vivo")
                content.sound = .default
                content.threadIdentifier = "matches"
                let trig = UNTimeIntervalNotificationTrigger(timeInterval: at - now, repeats: false)
                try? await c.add(UNNotificationRequest(identifier: Self.prefix + x.id + "|" + String(stage), content: content, trigger: trig))
                n += 1
            }
        }
        Self.scheduleRefresh()
    }

    // ---------- actualización con la app cerrada ----------

    /** se registra al arrancar la app (antes de que termine de abrir, como pide iOS) */
    static func registerBackground() {
        BGTaskScheduler.shared.register(forTaskWithIdentifier: refreshId, using: nil) { task in
            scheduleRefresh()
            let work = Task {
                if await MatchAlerts.shared.sync() { await MatchAlerts.shared.reschedule() }
                task.setTaskCompleted(success: true)
            }
            task.expirationHandler = { work.cancel() }
        }
    }

    static func scheduleRefresh() {
        let r = BGAppRefreshTaskRequest(identifier: refreshId)
        r.earliestBeginDate = Date(timeIntervalSinceNow: 3600)
        try? BGTaskScheduler.shared.submit(r)
    }
}
