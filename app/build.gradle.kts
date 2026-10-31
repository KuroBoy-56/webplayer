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

android {
    namespace = "com.latmpx.player"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.latmpx.player.tv"
        minSdk = 23
        targetSdk = 36
        versionCode = 7
        versionName = "1.3.2"
        buildConfigField("String", "PANEL_MASTER_KEY", "\"$panelMasterKey\"")
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            // para pruebas firma con la clave de depuración; para publicar crea tu propia clave en Build > Generate Signed APK
            signingConfig = signingConfigs.getByName("debug")
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
