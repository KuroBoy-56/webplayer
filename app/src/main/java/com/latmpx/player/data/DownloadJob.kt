package com.latmpx.player.data

import android.Manifest
import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.job.JobInfo
import android.app.job.JobParameters
import android.app.job.JobScheduler
import android.app.job.JobService
import android.content.ComponentName
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.latmpx.player.R
import com.latmpx.player.tr

/**
 * Mantiene viva la descarga con la app en segundo plano (Play Store, sin servicio en primer plano ni el permiso
 * FOREGROUND_SERVICE_DATA_SYNC, que Google pide justificar con un video). No descarga nada por sí mismo: el trabajo lo
 * hace Downloads; esto es una tarea de JobScheduler mientras haya algo en la cola.
 *  - Android 14 o más: «transferencia de datos iniciada por el usuario» (setUserInitiated, permiso
 *    RUN_USER_INITIATED_JOBS): sin límite de tiempo y con la notificación del progreso, lo que Google recomienda para
 *    las descargas que pide el usuario. Solo se puede pedir con la app a la vista: al tocar «Descargar», o al volver a
 *    la app (promote) si la cola siguió como tarea común.
 *  - Antes de Android 14: una tarea común; el sistema le da unos 10 min cada vez y la vuelve a lanzar mientras quede
 *    algo (la descarga sigue donde iba, con Range).
 */
class DownloadJob : JobService() {
    companion object {
        private const val JOB = 4207
        private const val CHANNEL = "downloads"
        private const val ID = 4207
        private var lastNotify = 0L
        /** la tarea que está corriendo (para terminarla cuando la cola se vacía) */
        @Volatile private var running: Pair<DownloadJob, JobParameters>? = null

        private fun pending(): Boolean = Downloads.all().any { it.state == Downloads.State.RUNNING || it.state == Downloads.State.QUEUED }

        private fun scheduler(ctx: Context): JobScheduler? = ctx.getSystemService(JobScheduler::class.java)

        private fun scheduled(js: JobScheduler): JobInfo? = runCatching { js.allPendingJobs.firstOrNull { it.id == JOB } }.getOrNull()

        /** pide la tarea; userInitiated solo con la app a la vista (si no se puede, una tarea común) */
        private fun schedule(ctx: Context, userInitiated: Boolean) {
            val js = scheduler(ctx) ?: return
            fun build(ui: Boolean): JobInfo {
                val b = JobInfo.Builder(JOB, ComponentName(ctx, DownloadJob::class.java))
                    .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                if (ui && Build.VERSION.SDK_INT >= 34) b.setUserInitiated(true)
                return b.build()
            }
            val ui = userInitiated && Build.VERSION.SDK_INT >= 34
            val ok = runCatching { js.schedule(build(ui)) == JobScheduler.RESULT_SUCCESS }.getOrDefault(false)
            if (!ok && ui) runCatching { js.schedule(build(false)) }
        }

        /** hay algo en la cola (se llama al empezar la cola, normalmente al tocar «Descargar») */
        fun start(ctx: Context) {
            val js = scheduler(ctx) ?: return
            // ya pedida o corriendo: pedirla otra vez con el mismo número cortaría la que corre
            if (running != null || scheduled(js) != null) return
            schedule(ctx, userInitiated = true)
        }

        /** la app volvió a estar a la vista: si la cola sigue como tarea común, pasa a ser iniciada por el usuario */
        fun promote(ctx: Context) {
            if (Build.VERSION.SDK_INT < 34 || !pending()) return
            val js = scheduler(ctx) ?: return
            val cur = scheduled(js)
            if (cur != null && cur.isUserInitiated) return
            schedule(ctx, userInitiated = true)
        }

        /** la cola se vació */
        fun stop(ctx: Context) {
            running = null
            scheduler(ctx)?.let { js -> runCatching { js.cancel(JOB) } }
            runCatching { NotificationManagerCompat.from(ctx).cancel(ID) }
        }

        /** actualiza la notificación (como mucho cada segundo) */
        @SuppressLint("MissingPermission")
        fun progress(ctx: Context) {
            val now = System.currentTimeMillis()
            if (now - lastNotify < 1000) return
            lastNotify = now
            if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
            if (Downloads.all().none { it.state == Downloads.State.RUNNING }) return
            runCatching { NotificationManagerCompat.from(ctx).notify(ID, build(ctx)) }
        }

        private fun build(ctx: Context): Notification {
            channel(ctx)
            val cur = Downloads.all().firstOrNull { it.state == Downloads.State.RUNNING }
            val left = Downloads.all().count { it.state == Downloads.State.QUEUED }
            val title = cur?.let { if (it.kind == Kind.SERIES) tr(R.string.ep_short, it.seriesName, it.season, it.episode) else it.title } ?: tr(R.string.downloads)
            val open = ctx.packageManager.getLaunchIntentForPackage(ctx.packageName)?.let {
                PendingIntent.getActivity(ctx, 0, it, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
            }
            return NotificationCompat.Builder(ctx, CHANNEL)
                .setSmallIcon(android.R.drawable.stat_sys_download)
                .setContentTitle(tr(R.string.dl_notif_title, title))
                .setContentText(if (left > 0) tr(R.string.dl_notif_waiting, cur?.percent ?: 0, left) else "${cur?.percent ?: 0} %")
                .setProgress(100, cur?.percent ?: 0, cur == null || cur.total <= 0)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setSilent(true)
                .setContentIntent(open)
                .build()
        }

        private fun channel(ctx: Context) {
            if (Build.VERSION.SDK_INT < 26) return
            val nm = ctx.getSystemService(NotificationManager::class.java) ?: return
            if (nm.getNotificationChannel(CHANNEL) == null) {
                nm.createNotificationChannel(NotificationChannel(CHANNEL, tr(R.string.downloads), NotificationManager.IMPORTANCE_LOW))
            }
        }
    }

    override fun onStartJob(params: JobParameters): Boolean {
        // proceso nuevo: App.onCreate ya llamó a Downloads.init, que siguió con lo pendiente
        if (!pending()) return false
        running = this to params
        // Android 14+: la transferencia iniciada por el usuario necesita su notificación
        if (Build.VERSION.SDK_INT >= 34 && params.isUserInitiatedJob) {
            runCatching { setNotification(params, ID, build(this), JOB_END_NOTIFICATION_POLICY_REMOVE) }
        }
        return true
    }

    override fun onStopJob(params: JobParameters): Boolean {
        if (running?.second === params) running = null
        // el sistema la cortó (tiempo, red): si queda algo, que la vuelva a lanzar
        return pending()
    }
}
