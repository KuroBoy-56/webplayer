package com.latmpx.player.data

enum class Kind { MOVIE, SERIES, LIVE }

data class Category(val id: String, val name: String, val kind: Kind) : java.io.Serializable

/** Película, serie o canal tal como llega de player_api.php */
data class Item(
    val id: Int,
    val name: String,
    val poster: String,
    val kind: Kind,
    val categoryId: String = "",
    val ext: String = "",
    val rating: Double = 0.0,
    val year: String = "",
    val added: Long = 0,
    val plot: String = "",
    val epgId: String = "",
    val backdrop: String = "",
) { : java.io.Serializable {
    /** clave única para progreso y favoritos */
    val key: String get() = "${kind.name.lowercase()}:$id"
}

data class Episode(
    val id: Int,
    val num: Int,
    val season: Int,
    val title: String,
    val ext: String,
    val plot: String,
    val image: String,
    val duration: String,
)

data class Details(
    val item: Item,
    val plot: String,
    val cast: String,
    val director: String,
    val genre: String,
    val duration: String,
    val backdrop: String,
    val trailer: String,
    val seasons: Map<Int, List<Episode>> = emptyMap(),
)

data class EpgEntry(val title: String, val desc: String, val start: Long, val end: Long)

data class Session(val dnsName: String, val base: String, val user: String, val pass: String, val expires: String)

/**
 * Entrada de "Continuar viendo" (panel progress.php).
 * key: "movie:12" o "series:5:301"; title: clave en el panel (nombre de la película o de la serie);
 * label: texto a mostrar (incluye temporada/episodio). Posiciones en milisegundos.
 */
data class Progress(
    val key: String,
    val title: String,
    val label: String,
    val poster: String,
    val position: Long,
    val duration: Long,
    val updated: Long,
    val url: String = "",
    val categoryId: String = "",
)

