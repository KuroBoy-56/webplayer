package com.latmpx.player

import android.content.Context
import android.content.res.Configuration
import android.content.res.Resources
import android.os.Build
import androidx.annotation.StringRes
import java.util.Locale

/**
 * Idioma de la app: español (por defecto), inglés, portugués (Brasil) y francés.
 *  - "auto": el idioma del equipo (si no es uno de los cuatro, español)
 *  - "es" / "en" / "pt" / "fr": elegido a mano en Cuenta › Idioma de la app
 * Cada actividad envuelve su contexto con el idioma (attachBaseContext); al cambiarlo se recrea la pantalla.
 */
object Lang {
    val SUPPORTED = listOf("es", "en", "pt", "fr")
    private const val PREFS = "latmpx" // mismas preferencias que Store
    private const val KEY = "app_lang"

    private lateinit var app: Context
    private var cachedTag = ""
    private var cachedRes: Resources? = null

    /** "auto" o el código elegido */
    var setting: String = "auto"
        private set

    /** se cambió el idioma desde Cuenta: al recrear la pantalla se vuelve a Cuenta */
    var reopenAccount = false

    /** idioma en uso (es/en/pt/fr) */
    var current: String = "es"
        private set

    /** idioma de TMDB para fichas y carátulas (las búsquedas siguen en es-MX: se comparan con el catálogo en español) */
    val tmdb: String get() = when (current) { "en" -> "en-US"; "pt" -> "pt-BR"; "fr" -> "fr-FR"; else -> "es-MX" }

    /** idioma elegido + idioma del equipo -> idioma a usar */
    fun resolve(setting: String, systemLang: String): String {
        if (setting in SUPPORTED) return setting
        val sys = systemLang.take(2).lowercase()
        return if (sys in SUPPORTED) sys else "es"
    }

    /** idioma del equipo (no el de la app: Locale.getDefault() ya puede estar cambiado) */
    private fun systemLocale(): Locale {
        val c = Resources.getSystem().configuration
        return if (Build.VERSION.SDK_INT >= 24) c.locales[0] else @Suppress("DEPRECATION") c.locale
    }

    private fun load(ctx: Context) {
        setting = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, "auto") ?: "auto"
        current = resolve(setting, systemLocale().language)
    }

    /** el idioma con la región del equipo si coincide (fechas), si no el idioma solo (pt = Brasil) */
    private fun locale(): Locale {
        val sys = systemLocale()
        return when {
            sys.language == current -> sys
            current == "pt" -> Locale("pt", "BR")
            else -> Locale(current)
        }
    }

    fun init(ctx: Context) {
        app = ctx.applicationContext
        load(ctx)
        Locale.setDefault(locale()) // nombres de meses y días en el idioma de la app
    }

    /** contexto con el idioma de la app: para attachBaseContext de cada actividad y del servicio */
    fun wrap(base: Context): Context {
        load(base)
        val l = locale()
        Locale.setDefault(l)
        val cfg = Configuration(base.resources.configuration)
        cfg.setLocale(l)
        return base.createConfigurationContext(cfg)
    }

    /** guarda el idioma elegido ("auto", "es", "en", "pt", "fr"); quien llama recrea la actividad */
    fun set(value: String) {
        app.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, value).apply()
        setting = value
        current = resolve(value, systemLocale().language)
        Locale.setDefault(locale())
    }

    /** recursos en el idioma de la app, para textos fuera de una pantalla (toasts, errores, notificaciones) */
    private fun res(): Resources {
        cachedRes?.takeIf { cachedTag == current }?.let { return it }
        val cfg = Configuration(app.resources.configuration)
        cfg.setLocale(locale())
        return app.createConfigurationContext(cfg).resources.also { cachedRes = it; cachedTag = current }
    }

    fun str(@StringRes id: Int, vararg args: Any): String = res().getString(id, *args)

    fun plural(id: Int, n: Int, vararg args: Any): String = res().getQuantityString(id, n, *args)
}

/** texto traducido fuera de Compose (atajo de Lang.str) */
fun tr(@StringRes id: Int, vararg args: Any): String = Lang.str(id, *args)
