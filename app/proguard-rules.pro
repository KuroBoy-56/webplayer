# FFmpeg (jellyfin media3) usa JNI
-keep class androidx.media3.decoder.ffmpeg.** { *; }
-dontwarn org.conscrypt.**
-dontwarn org.bouncycastle.**
-dontwarn org.openjsse.**

# Amazon Appstore SDK (verificación de licencia, data/AmazonLicense.kt)
-keep class com.amazon.device.drm.** { *; }
-dontwarn com.amazon.**
