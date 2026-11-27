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

    /**
     * color y dibujo de líneas de cada género, en el orden de [genres] (los mismos de Roku, webOS y el web player;
     * fuentes SVG en tools/genre-art del repositorio de Roku)
     */
    val genreStyles: List<Pair<Long, Int>> = listOf(
        0xFFB71C1C to R.drawable.genre_accion, 0xFF37474F to R.drawable.genre_suspenso, 0xFF2E7D32 to R.drawable.genre_aventura,
        0xFFD81B60 to R.drawable.genre_anime, 0xFF6A1B9A to R.drawable.genre_drama, 0xFFF9A825 to R.drawable.genre_comedia,
        0xFF212121 to R.drawable.genre_terror, 0xFF1565C0 to R.drawable.genre_scifi, 0xFF4527A0 to R.drawable.genre_fantasia,
        0xFFC2185B to R.drawable.genre_romance, 0xFF424242 to R.drawable.genre_crimen, 0xFF00897B to R.drawable.genre_animacion,
        0xFF5D4037 to R.drawable.genre_documental, 0xFF222222 to R.drawable.genre_4k,
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
