plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Versión = la de la app web (package.json de la raíz) para que el APK y el ZIP vayan juntos.
val versionWeb: String = Regex("\"version\"\\s*:\\s*\"([^\"]+)\"")
    .find(rootProject.file("../package.json").readText())?.groupValues?.get(1) ?: "0.0.0"
val codigoVersion: Int = (System.getenv("VERSION_CODE") ?: "1").toInt()

android {
    namespace = "pe.controlflota.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "pe.controlflota.app"
        minSdk = 24
        targetSdk = 35
        versionCode = codigoVersion
        versionName = versionWeb
    }

    signingConfigs {
        // Firma de prueba (incluida en el repo) para instalar el APK a mano y poder actualizarlo
        // encima. Para la Play Store se usa una clave propia por variables de entorno.
        create("flota") {
            val propia = System.getenv("FIRMA_ARCHIVO")
            storeFile = if (propia != null) file(propia) else rootProject.file("firma/controlflota-prueba.jks")
            storePassword = System.getenv("FIRMA_CLAVE") ?: "controlflota"
            keyAlias = System.getenv("FIRMA_ALIAS") ?: "controlflota"
            keyPassword = System.getenv("FIRMA_CLAVE_LLAVE") ?: System.getenv("FIRMA_CLAVE") ?: "controlflota"
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("flota")
        }
        debug {
            signingConfig = signingConfigs.getByName("flota")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    buildFeatures { buildConfig = true }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("androidx.swiperefreshlayout:swiperefreshlayout:1.1.0")
}
