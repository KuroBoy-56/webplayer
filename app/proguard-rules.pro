# FFmpeg (jellyfin media3) usa JNI
-keep class androidx.media3.decoder.ffmpeg.** { *; }
-dontwarn org.conscrypt.**
-dontwarn org.bouncycastle.**
-dontwarn org.openjsse.**

# Amazon Appstore SDK (verificación de licencia, data/AmazonLicense.kt): todo com.amazon.** tal cual, como pide Amazon
# («Obfuscate the code» del Appstore SDK). El SDK llena sus partes internas por reflexión, solo en clases cuyo nombre
# empieza con «com.amazon.» y con sus anotaciones; antes solo se guardaba com.amazon.device.drm.**, R8 renombraba el
# resto y la tienda contestaba siempre UNKNOWN_ERROR («Error al preguntar a la tienda» en el panel), aunque la copia
# fuera de la Amazon Appstore.
-keep class com.amazon.** { *; }
-keepattributes *Annotation*
-dontwarn com.amazon.**
