import SwiftUI
import Combine

/**
 * Destacados como la app de Android para celular (y Netflix): tarjetas grandes con la carátula, el título,
 * etiquetas y los botones Reproducir / Mi lista; se ven los bordes de las vecinas, pasan solas cada 6,5 s
 * y el fondo toma los colores de la carátula actual (difuminada).
 */
struct HeroCards: View {
    @EnvironmentObject var state: AppState
    @EnvironmentObject var cloud: Cloud
    let items: [Item]
    let width: CGFloat
    var topPad: CGFloat = 0
    @State private var page = 0
    @GestureState private var drag: CGFloat = 0
    private let timer = Timer.publish(every: 6.5, on: .main, in: .common).autoconnect()

    var body: some View {
        let cardW = min(width - 60, 420)
        let side = (width - cardW) / 2
        let step = cardW + 14
        let cardH = cardW / 0.70
        let cur = items.isEmpty ? nil : items[min(page, items.count - 1)]
        ZStack(alignment: .top) {
            // fondo: la carátula actual muy difuminada
            if let c = cur {
                ItemPoster(item: c).frame(width: width, height: cardH + topPad + 60).blur(radius: 50).opacity(0.75).clipped()
            }
            LinearGradient(colors: [Color.black.opacity(0.6), Color(hex: 0x141414, alpha: 0.4), Theme.bg], startPoint: .top, endPoint: .bottom)
            VStack(spacing: 12) {
                HStack(spacing: 14) {
                    ForEach(Array(items.enumerated()), id: \.element.key) { i, it in
                        let dist = min(1, abs(CGFloat(i - page) + (-drag / step)))
                        HeroCard(item: it, width: cardW, height: cardH)
                            .scaleEffect(1 - 0.1 * dist)
                            .opacity(1 - 0.4 * dist)
                    }
                }
                .frame(width: width, alignment: .leading)
                .offset(x: side - CGFloat(page) * step + drag)
                .animation(.interactiveSpring(response: 0.35, dampingFraction: 0.86), value: page)
                .gesture(
                    DragGesture(minimumDistance: 12)
                        .updating($drag) { v, s, _ in s = v.translation.width }
                        .onEnded { v in
                            let moved = -(v.predictedEndTranslation.width) / step
                            let n = page + Int(moved.rounded())
                            page = max(0, min(items.count - 1, n == page && abs(v.translation.width) > step / 4 ? page + (v.translation.width < 0 ? 1 : -1) : n))
                        }
                )
                if items.count > 1 {
                    HStack(spacing: 6) {
                        ForEach(0..<items.count, id: \.self) { i in
                            Capsule().fill(i == page ? Color.white : Color.white.opacity(0.33)).frame(width: i == page ? 18 : 6, height: 6)
                        }
                    }
                }
            }
            .padding(.top, topPad)
        }
        .frame(width: width, height: cardH + topPad + 30)
        .clipped()
        .onReceive(timer) { _ in
            if items.count > 1 && drag == 0 { withAnimation { page = (page + 1) % items.count } }
        }
    }
}

private struct HeroCard: View {
    @EnvironmentObject var state: AppState
    @EnvironmentObject var cloud: Cloud
    let item: Item
    let width: CGFloat
    let height: CGFloat

    var body: some View {
        ZStack(alignment: .bottom) {
            ItemPoster(item: item).frame(width: width, height: height).clipped()
                .contentShape(Rectangle())
                .onTapGesture { state.push(.detail(item)) }
            LinearGradient(colors: [.clear, Color.black.opacity(0.7), Color.black.opacity(0.95)], startPoint: .top, endPoint: .bottom)
                .frame(height: 260).allowsHitTesting(false)
            VStack(spacing: 6) {
                Text(item.name).font(.system(size: 26, weight: .black)).foregroundColor(.white).multilineTextAlignment(.center).lineLimit(2)
                let tags = heroTags(state, item)
                if !tags.isEmpty { Text(tags).font(.system(size: 13)).foregroundColor(Color(hex: 0xE5E5E5)).lineLimit(1) }
                HStack(spacing: 10) {
                    AppButton(text: "Reproducir", icon: "play.fill", height: 44) {
                        if item.kind == .movie { state.playMovie(item, ext: item.ext) } else { state.push(.detail(item)) }
                    }
                    let fav = cloud.isFav(item.key)
                    AppButton(text: fav ? "En mi lista" : "Mi lista", icon: fav ? "checkmark" : "plus", primary: false, height: 44) { Cloud.shared.toggleFav(item) }
                }.padding(.top, 8)
            }.padding(16)
        }
        .frame(width: width, height: height)
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color.white.opacity(0.18)))
        .shadow(color: .black.opacity(0.6), radius: 18, y: 8)
    }
}

/** "2024  •  Acción  •  ★ 7.8": año, categoría limpia y nota */
func heroTags(_ state: AppState, _ item: Item) -> String {
    let cats = item.kind == .series ? state.seriesCats : state.movieCats
    var cat = cats.first { $0.id == item.categoryId }?.name ?? ""
    cat = Rx.replace(cat, "^\\s*[A-Z]{2,4}\\s*[-|:]\\s*", "")
    cat = Rx.replace(cat, "\\b(peliculas|películas|series|vod)\\b", "", ci: true)
    cat = Rx.replace(cat, "[|\\-]+", " ").trimmed
    var parts = [String]()
    if !item.year.isEmpty { parts.append(String(item.year.prefix(4))) }
    if !cat.isEmpty && cat.count <= 22 { parts.append(cat.prefix(1).uppercased() + cat.dropFirst()) }
    if item.rating > 0 { parts.append(String(format: "★ %.1f", item.rating)) }
    return parts.joined(separator: "  •  ")
}
