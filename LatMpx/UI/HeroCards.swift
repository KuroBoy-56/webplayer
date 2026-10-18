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

    private var cardW: CGFloat { min(width - 60, 420) }
    private var step: CGFloat { cardW + 14 }
    private var cardH: CGFloat { cardW / 0.70 }
    private var current: Item? { items.isEmpty ? nil : items[min(page, items.count - 1)] }

    var body: some View {
        ZStack(alignment: .top) {
            // fondo: la carátula actual muy difuminada
            if let c = current {
                ItemPoster(item: c).frame(width: width, height: cardH + topPad + 60).blur(radius: 50).opacity(0.75).clipped()
            }
            LinearGradient(colors: [Color.black.opacity(0.6), Color(hex: 0x141414, alpha: 0.4), Theme.bg], startPoint: .top, endPoint: .bottom)
            VStack(spacing: 12) {
                cards
                if items.count > 1 { dots }
            }
            .padding(.top, topPad)
        }
        .frame(width: width, height: cardH + topPad + 30)
        .clipped()
        .onReceive(timer) { _ in
            if items.count > 1 && drag == 0 { withAnimation { page = (page + 1) % items.count } }
        }
    }

    private var cards: some View {
        let side: CGFloat = (width - cardW) / 2
        let x: CGFloat = side - CGFloat(page) * step + drag
        return HStack(spacing: 14) {
            ForEach(Array(items.enumerated()), id: \.element.key) { i, it in
                card(i, it)
            }
        }
        .frame(width: width, alignment: .leading)
        .offset(x: x)
        .animation(.interactiveSpring(response: 0.35, dampingFraction: 0.86), value: page)
        .gesture(
            DragGesture(minimumDistance: 12)
                .updating($drag) { v, s, _ in s = v.translation.width }
                .onEnded { v in snap(v.translation.width, v.predictedEndTranslation.width) }
        )
    }

    private func card(_ i: Int, _ it: Item) -> some View {
        let off: CGFloat = CGFloat(i - page) - drag / step
        let dist: CGFloat = min(1, abs(off))
        return HeroCard(item: it, width: cardW, height: cardH)
            .scaleEffect(1 - 0.1 * dist)
            .opacity(Double(1 - 0.4 * dist))
    }

    private var dots: some View {
        HStack(spacing: 6) {
            ForEach(0..<items.count, id: \.self) { i in
                Capsule().fill(i == page ? Theme.accent : Color.white.opacity(0.33)).frame(width: i == page ? 18 : 6, height: 6)
            }
        }
    }

    /** al soltar: la tarjeta hacia la que se lanzó (o la vecina si se arrastró más de un cuarto) */
    private func snap(_ moved: CGFloat, _ predicted: CGFloat) {
        let jump: Int = Int((-predicted / step).rounded())
        var n: Int = page + jump
        if n == page && abs(moved) > step / 4 { n = page + (moved < 0 ? 1 : -1) }
        page = max(0, min(items.count - 1, n))
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
                    AppButton(text: tr("Reproducir"), icon: "play.fill", height: 44) {
                        if item.kind == .movie { state.playMovie(item, ext: item.ext) } else { state.push(.detail(item)) }
                    }
                    let fav = cloud.isFav(item.key)
                    AppButton(text: tr(fav ? "En mi lista" : "Mi lista"), icon: fav ? "checkmark" : "plus", primary: false, height: 44) { Cloud.shared.toggleFav(item) }
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
