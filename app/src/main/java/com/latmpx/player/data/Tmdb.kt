package com.latmpx.player.data

import java.net.URLEncoder

/** Pósters de estrenos (TMDB now_playing) para el fondo del inicio de sesión, igual que la web. */
object Tmdb {
    private var cached: List<String>? = null

    suspend fun nowPlaying(key: String, pages: Int = 3): List<String> {
        cached?.let { return it }
        if (key.isBlank()) return emptyList()
        val out = ArrayList<String>()
        for (p in 1..pages) {
            val j = Net.obj("https://api.themoviedb.org/3/movie/now_playing?api_key=${URLEncoder.encode(key, "UTF-8")}&language=es-ES&page=$p") ?: break
            j.optJSONArray("results").mapObj { o -> o.s("poster_path").takeIf { it.isNotEmpty() } }
                .forEach { out += "https://image.tmdb.org/t/p/w342$it" }
        }
        val list = out.distinct().take(48)
        if (list.isNotEmpty()) cached = list
        return list
    }
}
