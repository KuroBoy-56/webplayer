import Foundation

/** Plataformas y géneros detectados por el nombre de la categoría, igual que la web y Android. */
struct Platform: Hashable, Identifiable {
    let key: String
    let label: String
    let image: String   // nombre en Assets ("" = sin imagen)
    let color: UInt32
    let kw: [String]
    var id: String { key }
}

enum Platforms {
    static let list: [Platform] = [
        Platform(key: "netflix", label: "Netflix", image: "plat_netflix", color: 0xE50914, kw: ["netflix"]),
        Platform(key: "disney", label: "Disney+", image: "plat_disney", color: 0x113CCF, kw: ["disney", "pixar", "star+", "star plus"]),
        Platform(key: "max", label: "HBO Max", image: "plat_max", color: 0x5822B4, kw: ["hbo", "\\bmax\\b"]),
        Platform(key: "prime", label: "Prime Video", image: "plat_prime", color: 0x00A8E1, kw: ["amazon", "prime"]),
        Platform(key: "marvel", label: "Marvel", image: "plat_marvel", color: 0xEC1D24, kw: ["marvel", "\\bmcu\\b"]),
        Platform(key: "apple", label: "Apple TV+", image: "plat_apple", color: 0x555555, kw: ["apple"]),
        Platform(key: "paramount", label: "Paramount+", image: "plat_paramount", color: 0x0064FF, kw: ["paramount"]),
        Platform(key: "dc", label: "DC", image: "plat_dc", color: 0x0476F2, kw: ["\\bdc\\b", "dc comics"]),
        Platform(key: "xmas", label: "Navidad", image: "plat_xmas", color: 0x1F7A3A, kw: ["navidad", "navide", "christmas", "xmas"]),
        Platform(key: "halloween", label: "Halloween", image: "plat_halloween", color: 0xFF6A00, kw: ["halloween", "terror", "horror"]),
    ]

    static let genres: [(String, [String])] = [
        ("Acción", ["accion", "action", "artes marciales"]),
        ("Suspenso", ["suspenso", "suspense", "thriller", "misterio", "mystery", "intriga"]),
        ("Aventura", ["aventura", "adventure"]),
        ("Anime", ["anime", "crunchyroll", "otaku"]),
        ("Drama", ["drama"]),
        ("Comedia", ["comedia", "comedy", "humor"]),
        ("Terror", ["terror", "horror", "miedo"]),
        ("Ciencia ficción", ["ciencia ficcion", "sci-fi", "scifi", "science fiction"]),
        ("Fantasía", ["fantasia", "fantasy"]),
        ("Romance", ["romance", "romantic", "romantica", "amor"]),
        ("Crimen", ["crimen", "crime", "policia", "mafia"]),
        ("Animación", ["animacion", "animation", "animada", "infantil", "kids", "cartoon"]),
        ("Documental", ["documental", "documentary", "docu"]),
        ("4K", ["4k", "uhd", "2160"]),
    ]

    static func matches(_ name: String, _ kw: [String]) -> Bool {
        let n = name.folded
        return kw.contains { k in k.contains("\\b") ? Rx.has(n, k) : n.contains(k) }
    }

    static func categoriesFor(_ cats: [Category], _ kw: [String]) -> Set<String> {
        Set(cats.filter { matches($0.name, kw) }.map { $0.id })
    }
}
