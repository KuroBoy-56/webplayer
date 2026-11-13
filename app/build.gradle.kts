import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

// Configuración local (local.properties o secretos de GitHub Actions). Nada de esto va en el repositorio.
val localProps: Properties = Properties().apply {
    val f = rootProject.file("local.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}
// llave maestra AES de login.php (hex de 64 caracteres). Única fuente: local.properties (nunca en el repositorio).
val panelMasterKey: String = localProps.getProperty("panel.master_key") ?: ""
// Google Play: el paquete (.aab) se sube firmado con la llave de subida (upload key); Google lo vuelve a firmar con la llave
// de la app (Play App Signing). La llave de subida nunca va en el repositorio: el workflow la escribe desde los secretos
// en local.properties (upload.store_file, upload.store_password, upload.key_alias, upload.key_password).
val uploadStore: String = localProps.getProperty("upload.store_file") ?: ""

android {
    namespace = "com.latmpx.player"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.latmpx.player"
        minSdk = 23
        targetSdk = 36
        versionCode = 14
        versionName = "1.3.9"
        buildConfigField("String", "PANEL_MASTER_KEY", "\"$panelMasterKey\"")
    }

    signingConfigs {
        if (uploadStore.isNotEmpty()) create("upload") {
            storeFile = file(uploadStore)
            storePassword = localProps.getProperty("upload.store_password")
            keyAlias = localProps.getProperty("upload.key_alias")
            keyPassword = localProps.getProperty("upload.key_password")
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            // para pruebas firma con la clave de depuración; para publicar crea tu propia clave en Build > Generate Signed APK
            // con la llave de subida para Google Play; sin ella, la de depuración (solo para probar: Play no la acepta)
            signingConfig = signingConfigs.getByName(if (uploadStore.isNotEmpty()) "upload" else "debug")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    buildFeatures {
        compose = true
        buildConfig = true
    }
}

val media3 = "1.9.0"

dependencies {
    implementation(platform("androidx.compose:compose-bom:2025.07.00"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.activity:activity-compose:1.10.1")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.9.1")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.9.1")
    implementation("androidx.core:core-ktx:1.16.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")

    // reproductor: ExoPlayer + HLS + decodificador FFmpeg (Dolby AC3/E-AC3, DTS, TrueHD, MP2, FLAC, Opus... por software)
    implementation("androidx.media3:media3-exoplayer:$media3")
    implementation("androidx.media3:media3-exoplayer-hls:$media3")
    implementation("androidx.media3:media3-ui:$media3")
    implementation("androidx.media3:media3-datasource-okhttp:$media3")
    implementation("org.jellyfin.media3:media3-ffmpeg-decoder:$media3+1")

    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("com.squareup.okhttp3:okhttp-dnsoverhttps:4.12.0")
    implementation("io.coil-kt.coil3:coil-compose:3.3.0")
    implementation("io.coil-kt.coil3:coil-network-okhttp:3.3.0")
}
