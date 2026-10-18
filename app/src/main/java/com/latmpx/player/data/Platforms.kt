package com.latmpx.player.data

import com.latmpx.player.tr
import com.latmpx.player.R
import java.text.Normalizer

/** Plataformas y géneros detectados por el nombre de la categoría, igual que la web. */
data class Platform(val key: String, val label: String, val image: Int, val color: Long, val kw: List<String>)

object Platforms {
    // getter: las etiquetas siguen el idioma de la app (las palabras clave quedan en español, como las categorías del servidor)
    val list get() = listOf(
        Platform("netflix", "Netflix", R.drawable.plat_netflix, 0xFFE50914, listOf("netflix")),
        Platform("disney", "Disney+", R.drawable.plat_disney, 0xFF113CCF, listOf("disney", "pixar", "star+", "star plus")),
        Platform("max", "HBO Max", R.drawable.plat_max, 0xFF5822B4, listOf("hbo", "\\bmax\\b")),
        Platform("prime", "Prime Video", R.drawable.plat_prime, 0xFF00A8E1, listOf("amazon", "prime")),
        Platform("marvel", "Marvel", R.drawable.plat_marvel, 0xFFEC1D24, listOf("marvel", "\\bmcu\\b")),
        Platform("apple", "Apple TV+", R.drawable.plat_apple, 0xFF555555, listOf("apple")),
        Platform("paramount", "Paramount+", R.drawable.plat_paramount, 0xFF0064FF, listOf("paramount")),
        Platform("dc", "DC", R.drawable.plat_dc, 0xFF0476F2, listOf("\\bdc\\b", "dc comics")),
        Platform("xmas", tr(R.string.plat_xmas), R.drawable.plat_xmas, 0xFF1F7A3A, listOf("navidad", "navide", "christmas", "xmas")),
        Platform("halloween", "Halloween", R.drawable.plat_halloween, 0xFFFF6A00, listOf("halloween", "terror", "horror")),
    )

    val genres get() = listOf(
        tr(R.string.genre_action) to listOf("accion", "action", "artes marciales"),
        tr(R.string.genre_suspense) to listOf("suspenso", "suspense", "thriller", "misterio", "mystery", "intriga"),
        tr(R.string.genre_adventure) to listOf("aventura", "adventure"),
        "Anime" to listOf("anime", "crunchyroll", "otaku"),
        "Drama" to listOf("drama"),
        tr(R.string.genre_comedy) to listOf("comedia", "comedy", "humor"),
        tr(R.string.genre_horror) to listOf("terror", "horror", "miedo"),
        tr(R.string.genre_scifi) to listOf("ciencia ficcion", "sci-fi", "scifi", "science fiction"),
        tr(R.string.genre_fantasy) to listOf("fantasia", "fantasy"),
        "Romance" to listOf("romance", "romantic", "romantica", "amor"),
        tr(R.string.genre_crime) to listOf("crimen", "crime", "policia", "mafia"),
        tr(R.string.genre_animation) to listOf("animacion", "animation", "animada", "infantil", "kids", "cartoon"),
        tr(R.string.genre_documentary) to listOf("documental", "documentary", "docu"),
        "4K" to listOf("4k", "uhd", "2160"),
    )

    // expresiones compiladas una sola vez (antes se compilaban en cada llamada, miles por pantalla)
    private val MARKS = Regex("\\p{M}+")
    private val kwRegex = java.util.concurrent.ConcurrentHashMap<String, Regex>()

    fun fold(s: String): String = Normalizer.normalize(s.lowercase(), Normalizer.Form.NFD).replace(MARKS, "")

    fun matches(name: String, kw: List<String>): Boolean {
        val n = fold(name)
        return kw.any { k -> if (k.contains("\\b")) kwRegex.getOrPut(k) { Regex(k) }.containsMatchIn(n) else n.contains(k) }
    }

    fun categoriesFor(cats: List<Category>, kw: List<String>): Set<String> = cats.filter { matches(it.name, kw) }.map { it.id }.toSet()
}
