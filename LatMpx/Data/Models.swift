import Foundation

enum Kind: String, Codable { case movie, series, live }

struct Category: Codable, Hashable, Identifiable {
    let id: String
    let name: String
    let kind: Kind
}

/** Película, serie o canal tal como llega de player_api.php */
struct Item: Codable, Hashable, Identifiable {
    var id: Int
    var name: String
    var poster: String
    var kind: Kind
    var categoryId: String = ""
    var ext: String = ""
    var rating: Double = 0
    var year: String = ""
    var added: Int64 = 0
    var plot: String = ""
    var epgId: String = ""
    var backdrop: String = ""
    var cast: String = ""
    /** id de TMDB que manda el servidor (tmdb / tmdb_id): una sola carátula por título en el panel (PanelImg).
     *  Opcional: el catálogo guardado de antes no lo trae y se sigue leyendo igual. */
    var tmdb: String? = nil

    /** clave única para progreso y favoritos */
    var key: String { "\(kind.rawValue):\(id)" }
}

struct Episode: Hashable, Identifiable {
    let id: Int
    let num: Int
    let season: Int
    let title: String
    let ext: String
    let plot: String
    let image: String
    let duration: String
}

struct Details {
    var item: Item
    var plot: String
    var cast: String
    var director: String
    var genre: String
    var duration: String
    var backdrop: String
    var trailer: String
    var tmdbId: String = ""
    /** temporada -> episodios (ordenadas) */
    var seasons: [(Int, [Episode])] = []
}

struct EpgEntry: Hashable {
    let title: String
    let desc: String
    let start: Double // segundos
    let end: Double
}

struct Session: Equatable {
    var dnsName: String
    var base: String
    var user: String
    var pass: String
    var expires: String
    var activeCons: String = "0"
    var maxCons: String = "0"
    var createdAt: String = ""
}

/**
 * Entrada de "Continuar viendo" (panel progress.php).
 * key: "movie:12" o "series:5:301"; title: clave en el panel (nombre de la película o de la serie);
 * label: texto a mostrar. Posiciones en milisegundos.
 */
struct Progress: Hashable {
    var key: String
    var title: String
    var label: String
    var poster: String
    var position: Int64
    var duration: Int64
    var updated: Double
    var url: String = ""
    var categoryId: String = ""

    var fraction: Double { duration > 0 ? min(1, max(0, Double(position) / Double(duration))) : 0 }
}
