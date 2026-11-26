import SwiftUI
import UIKit

/**
 * Cuenta › Equipos favoritos (como el celular Android): la lista (tocar uno lo quita), «+ Agregar equipo» (deporte →
 * liga o selecciones → equipo, de los próximos 21 días del panel) y el permiso de notificaciones del iPhone. Se guardan
 * en la nube (api/alerts.php) y el iPhone avisa 30 y 10 minutos antes y al empezar cada partido (MatchAlerts).
 */
struct TeamsSheet: View {
    @Environment(\.dismiss) private var dismiss
    @ObservedObject private var ma = MatchAlerts.shared
    private enum Step: Equatable { case list, sport, league(String), team(String, String) }
    @State private var step: Step = .list
    @State private var fx: Fixtures?
    @State private var labels: [String: String] = [:]
    @State private var loading = false
    @State private var busy = false
    @State private var err: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) { content }
                    .padding(20)
                    .frame(maxWidth: 640)
                    .frame(maxWidth: .infinity)
            }
            .background(Color(hex: 0x141414).ignoresSafeArea())
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(step == .list ? tr("Cerrar") : tr("Atrás")) { back() }
                }
            }
        }
        .preferredColorScheme(.dark)
        .task { await ma.refreshPermission() }
    }

    private var title: String {
        switch step {
        case .list: return tr("Equipos favoritos")
        case .sport: return tr("Elige el deporte")
        case .league: return tr("Elige la liga")
        case .team: return tr("Elige el equipo")
        }
    }

    @ViewBuilder private var content: some View {
        switch step {
        case .list:
            Text(tr("Te avisamos 30 minutos antes, 10 minutos antes y al empezar cada partido de tus equipos, aunque la app esté cerrada."))
                .font(.system(size: 14)).foregroundColor(Theme.muted)
            permissionBox
            if let e = err { Text(e).font(.system(size: 13)).foregroundColor(Color(hex: 0xFF8A80)) }
            if busy { ProgressView().frame(maxWidth: .infinity) }
            row("plus.circle.fill", tr("+ Agregar equipo"), nil) { err = nil; step = .sport; loadFx() }
            ForEach(ma.teams, id: \.self) { t in
                row("xmark.circle", t.name, tr("Toca para quitarlo")) { save(ma.teams.filter { $0 != t }) }
            }
        case .sport:
            if let f = fx {
                let list = sports(f)
                if list.isEmpty { empty(tr("No hay partidos próximos para elegir equipos.")) }
                ForEach(list, id: \.self) { sp in row(nil, labels[sp] ?? sp, nil) { step = .league(sp) } }
            } else { waiting }
        case .league(let sp):
            if let f = fx {
                ForEach(leagues(f, sp), id: \.0) { item in
                    row(item.1.region == "nat" ? "flag" : nil, item.1.name, item.1.country.isEmpty ? nil : item.1.country) { step = .team(sp, item.0) }
                }
            } else { waiting }
        case .team(_, let lg):
            if let f = fx {
                let list = teams(f, lg)
                if list.isEmpty { empty(tr("No hay equipos en esta liga.")) }
                ForEach(list, id: \.self) { t in
                    row(ma.teams.contains { $0.n == t.n } ? "checkmark.circle.fill" : nil, t.name, nil) {
                        step = .list
                        if !ma.teams.contains(where: { $0.n == t.n }) { save(ma.teams + [t]) }
                    }
                }
            } else { waiting }
        }
    }

    @ViewBuilder private var permissionBox: some View {
        if ma.permission != true {
            VStack(alignment: .leading, spacing: 10) {
                Text(ma.permission == false
                     ? tr("Las notificaciones están apagadas para la app. Actívalas en Ajustes del iPhone.")
                     : tr("Para avisarte, el iPhone tiene que permitir las notificaciones de la app."))
                    .font(.system(size: 14)).foregroundColor(.white)
                AppButton(text: ma.permission == false ? tr("Abrir Ajustes") : tr("Permitir notificaciones"), icon: "bell.badge") {
                    if ma.permission == false {
                        if let u = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(u) }
                    } else {
                        Task { _ = await ma.requestPermission() }
                    }
                }
            }
            .padding(14).background(Color(hex: 0x2A2111)).clipShape(RoundedRectangle(cornerRadius: 10))
        }
    }

    private var waiting: some View {
        HStack { ProgressView(); Text(tr("Cargando…")).foregroundColor(Theme.muted) }.frame(maxWidth: .infinity).padding(.top, 30)
    }

    private func empty(_ t: String) -> some View {
        Text(t).font(.system(size: 15)).foregroundColor(Theme.muted).padding(.vertical, 20)
    }

    private func row(_ icon: String?, _ t: String, _ sub: String?, _ f: @escaping () -> Void) -> some View {
        Button(action: f) {
            HStack(spacing: 14) {
                if let i = icon { Image(systemName: i).font(.system(size: 20)).foregroundColor(Theme.muted).frame(width: 28) }
                VStack(alignment: .leading, spacing: 2) {
                    Text(t).foregroundColor(.white)
                    if let s = sub { Text(s).font(.system(size: 13)).foregroundColor(Theme.muted) }
                }
                Spacer()
                Image(systemName: "chevron.right").foregroundColor(Theme.muted)
            }.padding(14).background(Color(hex: 0x1F1F1F)).clipShape(RoundedRectangle(cornerRadius: 10))
        }.buttonStyle(.plain).disabled(busy)
    }

    private func back() {
        switch step {
        case .list: dismiss()
        case .sport: step = .list
        case .league: step = .sport
        case .team(let sp, _): step = .league(sp)
        }
    }

    private func save(_ list: [FavTeam]) {
        busy = true
        err = nil
        Task { @MainActor in
            let ok = await ma.setTeams(list)
            busy = false
            if !ok { err = tr("No se pudo guardar. Inténtalo de nuevo.") }
            // el primer equipo: el cuadro de permiso de iOS
            else if ma.permission == nil && !list.isEmpty { _ = await ma.requestPermission() }
        }
    }

    private func loadFx() {
        if fx != nil || loading { return }
        loading = true
        Task { @MainActor in
            async let r = SportsPanel.fixtures(0)
            async let d = Sports.load()
            let (res, data) = await (r, d)
            var m = [String: String]()
            for (k, v) in data?.sports ?? [:] { m[k] = v.label }
            labels = m
            loading = false
            if let f = res.fx { fx = f } else {
                err = tr("No hay partidos próximos para elegir equipos.")
                step = .list
            }
        }
    }

    // ---------- datos del JSON de 21 días ----------

    private func sports(_ f: Fixtures) -> [String] {
        Array(Set(f.leagues.values.map { $0.sport }.filter { !$0.isEmpty })).sorted { (labels[$0] ?? $0) < (labels[$1] ?? $1) }
    }

    /** primero las selecciones, después ligas y copas (como el celular) */
    private func leagues(_ f: Fixtures, _ sp: String) -> [(String, FxLeague)] {
        f.leagues.filter { $0.value.sport == sp }.map { ($0.key, $0.value) }.sorted {
            let a = $0.1.region == "nat", b = $1.1.region == "nat"
            return a != b ? a : $0.1.name.localizedCaseInsensitiveCompare($1.1.name) == .orderedAscending
        }
    }

    /** equipos de los próximos partidos de esa liga, por nombre */
    private func teams(_ f: Fixtures, _ lg: String) -> [FavTeam] {
        let sp = f.leagues[lg]?.sport ?? ""
        var out = [String: FavTeam]()
        for e in f.events where e.leagueId == lg {
            if !e.home.isEmpty && out[e.home] == nil { out[e.home] = FavTeam(n: e.home, l: e.homeLabel, b: e.homeBadge, lg: lg, sp: sp) }
            if !e.away.isEmpty && out[e.away] == nil { out[e.away] = FavTeam(n: e.away, l: e.awayLabel, b: e.awayBadge, lg: lg, sp: sp) }
        }
        return out.values.sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }
}
