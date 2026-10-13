package com.latmpx.player.player

import android.app.AlertDialog
import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import androidx.media3.ui.CaptionStyleCompat
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
import com.latmpx.player.data.Cloud
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
    private lateinit var ui2: PlayerUiModel
    private var tv = false
    private lateinit var pip: PlayerPip
    private lateinit var selector: DefaultTrackSelector
    private val ui = Handler(Looper.getMainLooper())

    private lateinit var session: Session
    /** ya se probó el otro protocolo (http / https) para este reproductor */
    private var schemeFlipped = false
    private lateinit var kind: Kind
    private lateinit var queue: List<QueueEntry>
    private var extra = ""
    private var saveTitle = ""
    private var savePoster = ""
    private var category = ""
    /** descargas: clave -> archivo del equipo (sin internet, sin sesión y sin progreso en el panel) */
    private var files: Map<String, String> = emptyMap()
    private val offline: Boolean get() = files.isNotEmpty()
    /** para canales: qué dirección alternativa (m3u8 / ts / sin extensión) se está usando en cada canal */
    private val liveAlt = HashMap<Int, Int>()
    private var retries = 0
    private var lastRetryAt = 0L
    private var userPickedTracks = false
    /** última tecla del control (que no sea Atrás): para saber si el usuario está usando los controles */
    private var lastUserKey = 0L

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val localFiles = intent.getStringArrayExtra(Play.X_FILES)
        session = Store.session() ?: if (localFiles != null) Session("", "", "", "", "") else run { finish(); return }
        // el protocolo con el que este servidor ya entregó video (http / https) va primero
        if (localFiles == null && Store.streamFlip && session.base.isNotEmpty()) session = session.copy(base = Xtream.otherScheme(session.base))
        kind = runCatching { Kind.valueOf(intent.getStringExtra(Play.X_KIND) ?: "") }.getOrDefault(Kind.MOVIE)
        val ids = intent.getIntArrayExtra(Play.X_IDS) ?: IntArray(0)
        val titles = intent.getStringArrayExtra(Play.X_TITLES) ?: emptyArray()
        val keys = intent.getStringArrayExtra(Play.X_KEYS) ?: emptyArray()
        val posters = intent.getStringArrayExtra(Play.X_POSTERS) ?: emptyArray()
        val exts = intent.getStringArrayExtra(Play.X_EXTS) ?: emptyArray()
        extra = intent.getStringExtra(Play.X_EXTRA).orEmpty()
        saveTitle = intent.getStringExtra(Play.X_SAVE_TITLE).orEmpty()
        savePoster = intent.getStringExtra(Play.X_SAVE_POSTER).orEmpty()
        category = intent.getStringExtra(Play.X_CATEGORY).orEmpty()
        queue = ids.indices.map { i -> QueueEntry(ids[i], titles.getOrElse(i) { "" }, keys.getOrElse(i) { "" }, posters.getOrElse(i) { "" }, exts.getOrElse(i) { "" }) }
        if (queue.isEmpty()) { finish(); return }
        if (localFiles != null) files = queue.indices.associate { i -> queue[i].key to localFiles.getOrElse(i) { "" } }
        val start = intent.getIntExtra(Play.X_INDEX, 0).coerceIn(0, queue.lastIndex)

        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        WindowInsetsControllerCompat(window, window.decorView).apply {
            hide(WindowInsetsCompat.Type.systemBars())
            systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }

        tv = Device.isTv(this)
        buildPlayer()
        pip = PlayerPip(this, player, tv).also { it.register() }
        ui2 = PlayerUiModel(player, kind == Kind.LIVE, tv).apply {
            episodes = if (kind == Kind.SERIES) queue.map { q -> q.title.removePrefix(saveTitle).trim().trimStart('·').trim().ifEmpty { q.title } } else emptyList()
            resize = Store.resizeMode
        }
        buildUi()
        view.player = player
        applyTitle(start)

        player.setMediaItems(queue.map { mediaItem(it) }, start, resumePosition(queue[start]))
        player.prepare()
        player.playWhenReady = true
        if (kind != Kind.LIVE) resumePosition(queue[start]).takeIf { it > 0 }?.let { showToast("Continuando desde " + fmt(it)) }
        ui.post(saver)
    }

    /* ---------------- interfaz ---------------- */

    private fun buildUi() {
        view = PlayerView(this).apply {
            useController = false // controles propios estilo Netflix (PlayerUi.kt)
            setKeepContentOnPlayerReset(true)
            resizeMode = Store.resizeMode
            setShowBuffering(PlayerView.SHOW_BUFFERING_NEVER)
            setBackgroundColor(Color.BLACK)
            // subtítulos grandes, blancos con borde, como Netflix
            subtitleView?.apply {
                setStyle(CaptionStyleCompat(Color.WHITE, Color.TRANSPARENT, Color.TRANSPARENT, CaptionStyleCompat.EDGE_TYPE_OUTLINE, Color.BLACK, Typeface.DEFAULT_BOLD))
                setFractionalTextSize(if (tv) 0.055f else 0.065f)
                setBottomPaddingFraction(0.08f)
            }
            isFocusable = false
        }
        val actions = PlayerActions(
            back = { finish() },
            next = { if (player.hasNextMediaItem()) { saveProgress(force = true); player.seekToNextMediaItem(); player.play() } },
            pickEpisode = { i -> saveProgress(force = true); player.seekTo(i, C.TIME_UNSET); player.prepare(); player.play() },
            zap = { d -> zap(d) },
            resize = { r -> view.resizeMode = r; ui2.resize = r; Store.resizeMode = r },
            pip = if (pip.supported) ({ ui2.panel = null; pip.enter() }) else null,
        )
        setContent {
            Box(Modifier.fillMaxSize().background(androidx.compose.ui.graphics.Color.Black)) {
                AndroidView(factory = { view }, modifier = Modifier.fillMaxSize())
                PlayerOverlay(ui2, actions)
            }
        }
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                when {
                    ui2.panel != null -> { ui2.panel = null; ui2.poke() }
                    ui2.locked -> { ui2.poke() }
                    // TV: el primer Atrás solo oculta los controles si el video se está viendo y el usuario los
                    // estaba usando. Con el canal cargando, reconectando o con error, sale directo: antes los
                    // controles volvían a aparecer con cada reintento y Atrás nunca salía del canal (deportes).
                    tv && ui2.visible && player.isPlaying && System.currentTimeMillis() - lastUserKey < 8_000 -> ui2.visible = false
                    else -> finish()
                }
            }
        })
    }

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    private fun showToast(t: String) { if (::ui2.isInitialized) ui2.toast = t }

    /** título grande (película, serie o canal) y debajo temporada/episodio */
    private fun applyTitle(i: Int) {
        val q = queue.getOrNull(i) ?: return
        if (kind == Kind.SERIES && saveTitle.isNotEmpty() && q.title.startsWith(saveTitle)) {
            ui2.title = saveTitle
            ui2.subtitle = q.title.removePrefix(saveTitle).trim().trimStart('·').trim()
        } else { ui2.title = q.title; ui2.subtitle = "" }
        ui2.index = i
        ui2.hasNext = kind == Kind.SERIES && i < queue.lastIndex
    }

    /* ---------------- reproductor ---------------- */

    private fun buildPlayer() {
        // FFmpeg entra cuando el equipo no tiene decodificador para ese audio (Dolby, DTS...)
        val renderers = DefaultRenderersFactory(this)
            .setExtensionRendererMode(DefaultRenderersFactory.EXTENSION_RENDERER_MODE_ON)
            .setEnableDecoderFallback(true) // si el decodificador por hardware no puede (4K/HEVC/10 bits), prueba el siguiente

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
            // 4K en cualquier equipo: no se limita la calidad al tamaño de la pantalla ni a lo que el equipo "dice" soportar
            clearViewportSizeConstraints()
            clearVideoSizeConstraints()
            setExceedVideoConstraintsIfNecessary(true)
            setExceedAudioConstraintsIfNecessary(true)
            setAllowVideoNonSeamlessAdaptiveness(true)
            if (tv) setTunnelingEnabled(false)
            setAllowVideoMixedMimeTypeAdaptiveness(true)
            setAllowAudioMixedMimeTypeAdaptiveness(true)
        })

        val load = DefaultLoadControl.Builder()
            // búfer amplio para 4K (alto bitrate) sin tardar en arrancar
            .setBufferDurationsMs(if (kind == Kind.LIVE) 15_000 else 30_000, if (kind == Kind.LIVE) 40_000 else 120_000, 1_500, 3_000)
            .setBackBuffer(if (kind == Kind.LIVE) 0 else 20_000, true)
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

        player.addListener(object : Player.Listener {
            override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
                applyTitle(player.currentMediaItemIndex)
                retries = 0
                if (kind == Kind.LIVE) {
                    queue.getOrNull(player.currentMediaItemIndex)?.let { Store.setLastChannel(it.id) }
                    showToast(mediaItem?.mediaMetadata?.title?.toString() ?: "")
                } else if (reason == Player.MEDIA_ITEM_TRANSITION_REASON_AUTO || reason == Player.MEDIA_ITEM_TRANSITION_REASON_SEEK) {
                    queue.getOrNull(player.currentMediaItemIndex)?.let { q ->
                        val pos = resumePosition(q)
                        if (pos > 0) player.seekTo(pos)
                    }
                }
            }

            override fun onPlayerError(error: PlaybackException) = handleError(error)

            override fun onTracksChanged(tracks: Tracks) {
                if (::ui2.isInitialized) ui2.tracksRev++
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
                if (::ui2.isInitialized) { ui2.playing = isPlaying; if (!isPlaying) ui2.poke() }
                // arrancó: se recuerda por qué protocolo entrega el video este servidor (para los siguientes)
                if (isPlaying && !offline) Store.session()?.let { s -> if (s.base.isNotEmpty()) Store.streamFlip = s.base != session.base }
                if (!isPlaying) saveProgress(force = true)
                if (::pip.isInitialized) pip.update()
            }

            override fun onVideoSizeChanged(videoSize: androidx.media3.common.VideoSize) {
                if (::pip.isInitialized) pip.update()
            }

            override fun onPlaybackStateChanged(state: Int) {
                if (::ui2.isInitialized) ui2.buffering = state == Player.STATE_BUFFERING || (state == Player.STATE_IDLE && player.playWhenReady)
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
        val local = files[q.key]
        val url = if (local != null) Uri.fromFile(java.io.File(local)).toString() else when (kind) {
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
        // el servidor no entrega el video por este protocolo (la sesión quedó en https y el video solo va por
        // http, o al revés): una vez se prueba el otro, en el mismo punto, antes de reintentar o dar el error
        if (isNetwork && !schemeFlipped && files[q.key] == null && session.base.isNotEmpty()) {
            schemeFlipped = true
            session = session.copy(base = Xtream.otherScheme(session.base))
            val pos = player.currentPosition
            for (i in 0 until player.mediaItemCount) queue.getOrNull(i)?.let { player.replaceMediaItem(i, mediaItem(it)) }
            if (kind == Kind.LIVE) player.seekToDefaultPosition(idx) else player.seekTo(idx, pos)
            player.prepare()
            player.play()
            return
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
        // al panel (Errores de las apps): qué contenido, qué error y el detalle técnico
        com.latmpx.player.data.ErrorReport.report(
            "playback",
            "No se pudo reproducir (${e.errorCodeName}): ${q.title}".take(300),
            "tipo=${kind.name} id=${q.id} ext=${q.ext}\n" + (e.cause?.toString().orEmpty()) + "\n" + e.stackTraceToString(),
            "Reproductor",
        )
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
            .setOnCancelListener { finish() } // Atrás sobre el aviso sale del reproductor
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
        if (offline) {
            val d = com.latmpx.player.data.Downloads.get(q.key) ?: return 0
            return if (d.position > 30_000 && (d.duration <= 0 || d.position < d.duration * 0.95)) d.position else 0
        }
        val p = Cloud.progress(q.key) ?: return 0
        return if (p.position > 30_000 && (p.duration <= 0 || p.position < p.duration * 0.95)) p.position else 0
    }

    /** Guarda en el panel con el formato de la web: película por nombre; serie una entrada por serie. */
    private fun saveProgress(force: Boolean = false) {
        if (kind == Kind.LIVE || !::player.isInitialized) return
        val q = queue.getOrNull(player.currentMediaItemIndex) ?: return
        val pos = player.currentPosition
        val dur = player.duration.takeIf { it != C.TIME_UNSET && it > 0 } ?: 0
        if (pos < 5_000) return
        if (offline) { com.latmpx.player.data.Downloads.savePosition(q.key, pos, dur); return }
        val url = player.currentMediaItem?.localConfiguration?.uri?.toString().orEmpty()
        Cloud.saveProgress(
            Progress(
                key = q.key, title = saveTitle.ifEmpty { q.title }, label = q.title,
                poster = savePoster.ifEmpty { q.poster }, position = pos, duration = dur,
                updated = System.currentTimeMillis(), url = url, categoryId = category,
            ),
            force,
        )
    }

    private val saver = object : Runnable {
        override fun run() {
            if (::player.isInitialized && player.isPlaying) saveProgress()
            ui.postDelayed(this, 10_000)
        }
    }

    /* ---------------- control remoto ---------------- */

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (!::ui2.isInitialized) return super.dispatchKeyEvent(event)
        val k = event.keyCode
        if (event.action == KeyEvent.ACTION_DOWN && k != KeyEvent.KEYCODE_BACK) lastUserKey = System.currentTimeMillis()
        if (event.action == KeyEvent.ACTION_DOWN) {
            // teclas multimedia del control: siempre
            when (k) {
                KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE, KeyEvent.KEYCODE_HEADSETHOOK -> { ui2.toggle(); return true }
                KeyEvent.KEYCODE_MEDIA_PLAY -> { player.play(); ui2.poke(); return true }
                KeyEvent.KEYCODE_MEDIA_PAUSE -> { player.pause(); ui2.poke(); return true }
                KeyEvent.KEYCODE_MEDIA_FAST_FORWARD -> if (kind != Kind.LIVE) { player.seekForward(); ui2.seekHint = "10 s »"; return true }
                KeyEvent.KEYCODE_MEDIA_REWIND -> if (kind != Kind.LIVE) { player.seekBack(); ui2.seekHint = "« 10 s"; return true }
                KeyEvent.KEYCODE_MEDIA_NEXT -> if (kind == Kind.SERIES && player.hasNextMediaItem()) { player.seekToNextMediaItem(); return true }
                KeyEvent.KEYCODE_CHANNEL_UP, KeyEvent.KEYCODE_PAGE_UP -> if (kind == Kind.LIVE) { zap(-1); return true }
                KeyEvent.KEYCODE_CHANNEL_DOWN, KeyEvent.KEYCODE_PAGE_DOWN -> if (kind == Kind.LIVE) { zap(1); return true }
            }
            // controles escondidos: el control remoto no navega, actúa directo (como Netflix en TV)
            if (!ui2.visible && ui2.panel == null) {
                when (k) {
                    KeyEvent.KEYCODE_DPAD_LEFT -> if (kind != Kind.LIVE) { player.seekBack(); ui2.seekHint = "« 10 s"; return true }
                    KeyEvent.KEYCODE_DPAD_RIGHT -> if (kind != Kind.LIVE) { player.seekForward(); ui2.seekHint = "10 s »"; return true }
                    KeyEvent.KEYCODE_DPAD_UP -> if (kind == Kind.LIVE) { zap(-1); return true }
                    KeyEvent.KEYCODE_DPAD_DOWN -> if (kind == Kind.LIVE) { zap(1); return true }
                }
                if (k == KeyEvent.KEYCODE_DPAD_CENTER || k == KeyEvent.KEYCODE_ENTER || k == KeyEvent.KEYCODE_NUMPAD_ENTER ||
                    k == KeyEvent.KEYCODE_DPAD_UP || k == KeyEvent.KEYCODE_DPAD_DOWN || k == KeyEvent.KEYCODE_DPAD_LEFT || k == KeyEvent.KEYCODE_DPAD_RIGHT) {
                    ui2.poke(); ui2.focusTick++; return true
                }
            } else if (k != KeyEvent.KEYCODE_BACK) ui2.poke()
        }
        return super.dispatchKeyEvent(event)
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
        if (::pip.isInitialized) pip.onUserLeaveHint()
    }

    override fun onPictureInPictureModeChanged(isInPictureInPictureMode: Boolean, newConfig: android.content.res.Configuration) {
        super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig)
        if (::ui2.isInitialized) { ui2.visible = !isInPictureInPictureMode; ui2.panel = null }
        // se cerró la ventanita con la X (la actividad queda detenida): se sale del reproductor
        if (!isInPictureInPictureMode && lifecycle.currentState == androidx.lifecycle.Lifecycle.State.CREATED) finish()
    }

    override fun onStop() {
        super.onStop()
        saveProgress(force = true)
        if (::player.isInitialized && !(Build.VERSION.SDK_INT >= Build.VERSION_CODES.N && isInPictureInPictureMode)) player.pause()
    }

    override fun onDestroy() {
        if (::pip.isInitialized) pip.unregister()
        ui.removeCallbacksAndMessages(null)
        if (::player.isInitialized) { saveProgress(force = true); player.release() }
        super.onDestroy()
    }

    private fun fmt(ms: Long): String {
        val s = ms / 1000
        return if (s >= 3600) "%d:%02d:%02d".format(s / 3600, s % 3600 / 60, s % 60) else "%d:%02d".format(s / 60, s % 60)
    }
}
