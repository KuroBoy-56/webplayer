package com.latmpx.player.player

import android.app.AlertDialog
import android.app.PictureInPictureParams
import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Rational
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.core.os.LocaleListCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.Tracks
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.exoplayer.trackselection.DefaultTrackSelector
import androidx.media3.extractor.DefaultExtractorsFactory
import androidx.media3.extractor.ts.DefaultTsPayloadReaderFactory
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import com.latmpx.player.Device
import com.latmpx.player.data.Kind
import com.latmpx.player.data.Net
import com.latmpx.player.data.Progress
import com.latmpx.player.data.Session
import com.latmpx.player.data.Store
import com.latmpx.player.data.Xtream

/**
 * Reproductor nativo con ExoPlayer (Media3).
 * - Decodificador FFmpeg para audio que el equipo no soporta (AC3, E-AC3, DTS, TrueHD, MP2...): ya no hace falta convertir en el hosting.
 * - Pistas de audio y subtítulos desde el botón de ajustes; por defecto el idioma del equipo (o el último elegido a mano).
 * - Series: pasa solo al siguiente episodio. Canales: arriba/abajo o CH+/CH- cambian de canal.
 * - Si la conexión se corta (algo común en IPTV), retoma donde iba.
 */
@androidx.annotation.OptIn(markerClass = [UnstableApi::class])
class PlayerActivity : ComponentActivity() {
    private lateinit var player: ExoPlayer
    private lateinit var view: PlayerView
    private lateinit var title: TextView
    private lateinit var toast: TextView
    private lateinit var selector: DefaultTrackSelector
    private val ui = Handler(Looper.getMainLooper())

    private lateinit var session: Session
    private lateinit var kind: Kind
    private lateinit var queue: List<QueueEntry>
    private var extra = ""
    /** para canales: qué dirección alternativa (m3u8 / ts / sin extensión) se está usando en cada canal */
    private val liveAlt = HashMap<Int, Int>()
    private var retries = 0
    private var lastRetryAt = 0L
    private var userPickedTracks = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        session = Store.session() ?: run { finish(); return }
        kind = runCatching { Kind.valueOf(intent.getStringExtra(Play.X_KIND) ?: "") }.getOrDefault(Kind.MOVIE)
        val ids = intent.getIntArrayExtra(Play.X_IDS) ?: IntArray(0)
        val titles = intent.getStringArrayExtra(Play.X_TITLES) ?: emptyArray()
        val keys = intent.getStringArrayExtra(Play.X_KEYS) ?: emptyArray()
        val posters = intent.getStringArrayExtra(Play.X_POSTERS) ?: emptyArray()
        val exts = intent.getStringArrayExtra(Play.X_EXTS) ?: emptyArray()
        extra = intent.getStringExtra(Play.X_EXTRA).orEmpty()
        queue = ids.indices.map { i -> QueueEntry(ids[i], titles.getOrElse(i) { "" }, keys.getOrElse(i) { "" }, posters.getOrElse(i) { "" }, exts.getOrElse(i) { "" }) }
        if (queue.isEmpty()) { finish(); return }
        val start = intent.getIntExtra(Play.X_INDEX, 0).coerceIn(0, queue.lastIndex)

        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        WindowInsetsControllerCompat(window, window.decorView).apply {
            hide(WindowInsetsCompat.Type.systemBars())
            systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }

        buildUi()
        buildPlayer()

        player.setMediaItems(queue.map { mediaItem(it) }, start, resumePosition(queue[start]))
        player.prepare()
        player.playWhenReady = true
        if (kind != Kind.LIVE) resumePosition(queue[start]).takeIf { it > 0 }?.let { showToast("Continuando desde " + fmt(it)) }
        ui.post(saver)
    }

    /* ---------------- interfaz ---------------- */

    private fun buildUi() {
        val root = FrameLayout(this).apply { setBackgroundColor(Color.BLACK) }
        view = PlayerView(this).apply {
            useController = true
            setShowSubtitleButton(true)
            setShowNextButton(queue.size > 1)
            setShowPreviousButton(queue.size > 1)
            setShowFastForwardButton(kind != Kind.LIVE)
            setShowRewindButton(kind != Kind.LIVE)
            controllerShowTimeoutMs = 4000
            setKeepContentOnPlayerReset(true)
            resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT
            setShowBuffering(PlayerView.SHOW_BUFFERING_ALWAYS)
            setControllerVisibilityListener(PlayerView.ControllerVisibilityListener { v -> title.visibility = v })
            isFocusable = true
            isFocusableInTouchMode = true
        }
        root.addView(view, FrameLayout.LayoutParams(-1, -1))
        title = TextView(this).apply {
            setTextColor(Color.WHITE); textSize = 18f; setTypeface(typeface, Typeface.BOLD)
            setShadowLayer(6f, 0f, 0f, Color.BLACK)
            setPadding(dp(24), dp(18), dp(24), dp(8))
            maxLines = 2
        }
        root.addView(title, FrameLayout.LayoutParams(-1, -2, Gravity.TOP))
        toast = TextView(this).apply {
            setTextColor(Color.WHITE); textSize = 15f
            setBackgroundColor(0xCC000000.toInt())
            setPadding(dp(16), dp(10), dp(16), dp(10))
            visibility = View.GONE
        }
        root.addView(toast, FrameLayout.LayoutParams(-2, -2, Gravity.TOP or Gravity.END).apply { setMargins(dp(20), dp(20), dp(20), dp(20)) })
        setContentView(root)
        view.requestFocus()
    }

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    private val hideToast = Runnable { toast.visibility = View.GONE }
    private fun showToast(t: String) {
        toast.text = t
        toast.visibility = View.VISIBLE
        ui.removeCallbacks(hideToast)
        ui.postDelayed(hideToast, 3000)
    }

    /* ---------------- reproductor ---------------- */

    private fun buildPlayer() {
        // FFmpeg entra cuando el equipo no tiene decodificador para ese audio (Dolby, DTS...)
        val renderers = DefaultRenderersFactory(this)
            .setExtensionRendererMode(DefaultRenderersFactory.EXTENSION_RENDERER_MODE_ON)
            .setEnableDecoderFallback(true)

        val http = OkHttpDataSource.Factory(Net.client).setUserAgent(Net.UA)
        val data = DefaultDataSource.Factory(this, http)
        val extractors = DefaultExtractorsFactory()
            .setConstantBitrateSeekingEnabled(true)          // AVI, MP3 y TS sin índice se pueden adelantar
            .setConstantBitrateSeekingAlwaysEnabled(true)
            .setTsExtractorFlags(DefaultTsPayloadReaderFactory.FLAG_ALLOW_NON_IDR_KEYFRAMES or DefaultTsPayloadReaderFactory.FLAG_DETECT_ACCESS_UNITS)

        selector = DefaultTrackSelector(this)
        selector.setParameters(selector.buildUponParameters().apply {
            setPreferredAudioLanguages(*audioLanguages().toTypedArray())
            val sub = Store.subLang
            if (sub.isNullOrEmpty()) setIgnoredTextSelectionFlags(C.SELECTION_FLAG_DEFAULT) // subtítulos apagados salvo los forzados
            else setPreferredTextLanguage(sub)
            setExceedRendererCapabilitiesIfNecessary(true)
            setAllowVideoMixedMimeTypeAdaptiveness(true)
            setAllowAudioMixedMimeTypeAdaptiveness(true)
        })

        val load = DefaultLoadControl.Builder()
            .setBufferDurationsMs(15_000, if (kind == Kind.LIVE) 30_000 else 60_000, 1_500, 3_000)
            .build()

        player = ExoPlayer.Builder(this, renderers)
            .setMediaSourceFactory(DefaultMediaSourceFactory(data, extractors))
            .setTrackSelector(selector)
            .setLoadControl(load)
            .setAudioAttributes(AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MOVIE).build(), true)
            .setHandleAudioBecomingNoisy(true)
            .setSeekBackIncrementMs(10_000)
            .setSeekForwardIncrementMs(10_000)
            .build()
        view.player = player

        player.addListener(object : Player.Listener {
            override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
                title.text = mediaItem?.mediaMetadata?.title ?: ""
                retries = 0
                if (kind == Kind.LIVE) {
                    queue.getOrNull(player.currentMediaItemIndex)?.let { Store.setLastChannel(it.id) }
                    showToast(title.text.toString())
                } else if (reason == Player.MEDIA_ITEM_TRANSITION_REASON_AUTO || reason == Player.MEDIA_ITEM_TRANSITION_REASON_SEEK) {
                    queue.getOrNull(player.currentMediaItemIndex)?.let { q ->
                        val pos = resumePosition(q)
                        if (pos > 0) player.seekTo(pos)
                    }
                }
            }

            override fun onPlayerError(error: PlaybackException) = handleError(error)

            override fun onTracksChanged(tracks: Tracks) {
                // si el usuario eligió una pista a mano, se recuerda su idioma para lo siguiente
                if (player.trackSelectionParameters.overrides.isEmpty()) return
                for (g in tracks.groups) {
                    if (!g.isSelected) continue
                    for (i in 0 until g.length) {
                        if (!g.isTrackSelected(i)) continue
                        val lang = g.getTrackFormat(i).language ?: continue
                        when (g.type) {
                            C.TRACK_TYPE_AUDIO -> Store.audioLang = lang
                            C.TRACK_TYPE_TEXT -> Store.subLang = lang
                        }
                    }
                }
                if (tracks.groups.none { it.type == C.TRACK_TYPE_TEXT && it.isSelected }) Store.subLang = null
            }

            override fun onIsPlayingChanged(isPlaying: Boolean) {
                if (!isPlaying) saveProgress()
            }
        })
    }

    /** idiomas preferidos: el que el usuario eligió antes y luego los del equipo (español primero si el equipo está en español) */
    private fun audioLanguages(): List<String> {
        val out = ArrayList<String>()
        Store.audioLang?.let { out += it }
        val locales = LocaleListCompat.getAdjustedDefault()
        for (i in 0 until locales.size()) locales[i]?.language?.let { if (it !in out) out += it }
        return out
    }

    private fun mediaItem(q: QueueEntry): MediaItem {
        val url = when (kind) {
            Kind.MOVIE -> Xtream.movieUrl(session, q.id, q.ext)
            Kind.SERIES -> Xtream.episodeUrl(session, q.id, q.ext)
            Kind.LIVE -> Xtream.liveUrls(session, q.id)[liveAlt[q.id] ?: 0]
        }
        return MediaItem.Builder()
            .setUri(url)
            .setMediaId(q.key)
            .setMimeType(mimeFor(url))
            .setMediaMetadata(MediaMetadata.Builder().setTitle(q.title).setArtworkUri(q.poster.takeIf { it.isNotBlank() }?.let(Uri::parse)).build())
            .build()
    }

    private fun mimeFor(url: String): String? = when {
        url.endsWith(".m3u8", true) -> MimeTypes.APPLICATION_M3U8
        url.endsWith(".ts", true) -> MimeTypes.VIDEO_MP2T
        else -> null // MKV, MP4, AVI... los detecta ExoPlayer por el contenido
    }

    /* ---------------- errores ---------------- */

    private fun handleError(e: PlaybackException) {
        val idx = player.currentMediaItemIndex
        val q = queue.getOrNull(idx) ?: return
        // canal en vivo atrasado: se vuelve al directo
        if (e.errorCode == PlaybackException.ERROR_CODE_BEHIND_LIVE_WINDOW) { player.seekToDefaultPosition(); player.prepare(); return }

        val isNetwork = e.errorCode in 2000..2999
        if (kind == Kind.LIVE && (isNetwork || e.errorCode in 3000..3999 || e.errorCode in 4000..4999)) {
            // se prueba la siguiente forma de pedir el canal (m3u8 → ts → sin extensión)
            val alt = (liveAlt[q.id] ?: 0) + 1
            if (alt < Xtream.liveUrls(session, q.id).size) {
                liveAlt[q.id] = alt
                player.replaceMediaItem(idx, mediaItem(q))
                player.prepare()
                return
            }
        }
        // corte de conexión o del servidor IPTV: se retoma donde iba (hasta 6 veces seguidas)
        val now = System.currentTimeMillis()
        if (now - lastRetryAt > 120_000) retries = 0
        if ((isNetwork || e.errorCode == PlaybackException.ERROR_CODE_UNSPECIFIED) && retries < 6) {
            retries++
            lastRetryAt = now
            val pos = player.currentPosition
            showToast("Reconectando…")
            ui.postDelayed({
                if (kind == Kind.LIVE) player.seekToDefaultPosition() else player.seekTo(idx, pos)
                player.prepare()
                player.play()
            }, 1500L * retries)
            return
        }
        showErrorDialog(q, e)
    }

    private fun showErrorDialog(q: QueueEntry, e: PlaybackException) {
        if (isFinishing) return
        val decoding = e.errorCode in 4000..4999
        AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Dialog_Alert)
            .setTitle("No se pudo reproducir")
            .setMessage(
                if (decoding) "Este equipo no puede decodificar el formato de este contenido. Puedes intentarlo de nuevo o abrirlo en VLC."
                else "El servidor no respondió o el archivo está dañado. Puedes intentarlo de nuevo o abrirlo en VLC.",
            )
            .setPositiveButton("Reintentar") { _, _ -> retries = 0; player.prepare(); player.play() }
            .setNeutralButton("Abrir en VLC") { _, _ -> openVlc(player.currentMediaItem?.localConfiguration?.uri?.toString().orEmpty(), q.title) }
            .setNegativeButton("Cerrar") { _, _ -> finish() }
            .show()
    }

    /** Último recurso: VLC. Si no está instalado se abre la tienda (Play Store / tienda del TV). */
    private fun openVlc(url: String, name: String) {
        if (url.isEmpty()) return
        val i = Intent(Intent.ACTION_VIEW).setDataAndType(Uri.parse(url), "video/*").setPackage("org.videolan.vlc").putExtra("title", name)
        try {
            startActivity(i)
        } catch (e: ActivityNotFoundException) {
            try { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=org.videolan.vlc"))) }
            catch (e: ActivityNotFoundException) { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://play.google.com/store/apps/details?id=org.videolan.vlc"))) }
        }
    }

    /* ---------------- progreso ---------------- */

    private fun resumePosition(q: QueueEntry): Long {
        if (kind == Kind.LIVE) return C.TIME_UNSET
        val p = Store.progress(q.key) ?: return 0
        return if (p.position > 30_000 && (p.duration <= 0 || p.position < p.duration * 0.95)) p.position else 0
    }

    private fun saveProgress() {
        if (kind == Kind.LIVE || !::player.isInitialized) return
        val q = queue.getOrNull(player.currentMediaItemIndex) ?: return
        val pos = player.currentPosition
        val dur = player.duration.takeIf { it != C.TIME_UNSET && it > 0 } ?: 0
        if (pos < 5_000) return
        Store.saveProgress(Progress(q.key, q.title, q.poster, pos, dur, System.currentTimeMillis(), "", q.ext))
    }

    private val saver = object : Runnable {
        override fun run() {
            if (::player.isInitialized && player.isPlaying) saveProgress()
            ui.postDelayed(this, 10_000)
        }
    }

    /* ---------------- control remoto ---------------- */

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (event.action == KeyEvent.ACTION_DOWN && kind == Kind.LIVE) {
            when (event.keyCode) {
                KeyEvent.KEYCODE_CHANNEL_UP, KeyEvent.KEYCODE_PAGE_UP -> { zap(-1); return true }
                KeyEvent.KEYCODE_CHANNEL_DOWN, KeyEvent.KEYCODE_PAGE_DOWN -> { zap(1); return true }
                KeyEvent.KEYCODE_DPAD_UP -> if (!view.isControllerFullyVisible) { zap(-1); return true }
                KeyEvent.KEYCODE_DPAD_DOWN -> if (!view.isControllerFullyVisible) { zap(1); return true }
            }
        }
        if (event.action == KeyEvent.ACTION_DOWN && !view.isControllerFullyVisible) {
            when (event.keyCode) {
                // sin el menú visible: izquierda/derecha adelantan o retroceden 10 s, OK muestra los controles
                KeyEvent.KEYCODE_DPAD_LEFT -> if (kind != Kind.LIVE) { player.seekBack(); view.showController(); return true }
                KeyEvent.KEYCODE_DPAD_RIGHT -> if (kind != Kind.LIVE) { player.seekForward(); view.showController(); return true }
                KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER -> { view.showController(); return true }
            }
        }
        return view.dispatchKeyEvent(event) || super.dispatchKeyEvent(event)
    }

    private fun zap(dir: Int) {
        val n = player.mediaItemCount
        if (n < 2) return
        val next = ((player.currentMediaItemIndex + dir) % n + n) % n
        player.seekTo(next, C.TIME_UNSET)
        player.prepare()
        player.play()
    }

    /* ---------------- ciclo de vida ---------------- */

    override fun onUserLeaveHint() {
        super.onUserLeaveHint()
        // teléfono: al salir con el botón de inicio sigue en ventana flotante
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !Device.isTv(this) && ::player.isInitialized && player.isPlaying) {
            runCatching { enterPictureInPictureMode(PictureInPictureParams.Builder().setAspectRatio(Rational(16, 9)).build()) }
        }
    }

    override fun onStop() {
        super.onStop()
        saveProgress()
        if (::player.isInitialized && !(Build.VERSION.SDK_INT >= Build.VERSION_CODES.N && isInPictureInPictureMode)) player.pause()
    }

    override fun onDestroy() {
        ui.removeCallbacksAndMessages(null)
        if (::player.isInitialized) { saveProgress(); player.release() }
        super.onDestroy()
    }

    private fun fmt(ms: Long): String {
        val s = ms / 1000
        return if (s >= 3600) "%d:%02d:%02d".format(s / 3600, s % 3600 / 60, s % 60) else "%d:%02d".format(s / 60, s % 60)
    }
}
