package com.latmpx.player.data

import android.Manifest
import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.latmpx.player.R
import com.latmpx.player.tr

/**
 * Mantiene viva la descarga con la app en segundo plano (servicio en primer plano con una notificación
 * del progreso). No descarga nada por sí mismo: el trabajo lo hace Downloads.
 */
class DownloadService : Service() {
    companion object {
        private const val CHANNEL = "downloads"
        private const val ID = 4207
        private var lastNotify = 0L

        fun start(ctx: Context) {
            runCatching { ContextCompat.startForegroundService(ctx, Intent(ctx, DownloadService::class.java)) }
        }

        fun stop(ctx: Context) {
            runCatching { ctx.stopService(Intent(ctx, DownloadService::class.java)) }
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

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val n = build(this)
        runCatching {
            if (Build.VERSION.SDK_INT >= 29) startForeground(ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
            else startForeground(ID, n)
        }
        if (Downloads.all().none { it.state == Downloads.State.RUNNING || it.state == Downloads.State.QUEUED }) stopSelf()
        return START_NOT_STICKY
    }

    /** Android 15: el sistema corta los servicios de datos largos; la descarga sigue mientras la app esté abierta */
    override fun onTimeout(startId: Int, fgsType: Int) {
        stopSelf()
    }
}
