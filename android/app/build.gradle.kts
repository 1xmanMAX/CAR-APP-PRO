plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Versión = la de la app web (package.json de la raíz) para que el APK y el ZIP vayan juntos.
val versionWeb: String = Regex("\"version\"\\s*:\\s*\"([^\"]+)\"")
    .find(rootProject.file("../package.json").readText())?.groupValues?.get(1) ?: "0.0.0"
val codigoVersion: Int = (System.getenv("VERSION_CODE") ?: "1").toInt()
// Procesadores incluidos. Por omisión los de los celulares (ARM); para el emulador de la PC:
//   gradle assembleRelease -Pabis=x86_64
val abis: List<String> = ((findProperty("abis") as String?) ?: "arm64-v8a,armeabi-v7a").split(",").map { it.trim() }

// Node.js (de Termux) y el programa empaquetado los deja aquí `node scripts/preparar-android.mjs`.
val movil = file("movil")
if (abis.any { !file("movil/jniLibs/$it/libnode.so").exists() } || !file("movil/assets/app/iniciar.mjs").exists()) {
    logger.warn("Falta android/app/movil: ejecuta primero «node scripts/preparar-android.mjs» en la raíz del repo.")
}

android {
    namespace = "pe.controlflota.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "pe.controlflota.app"
        minSdk = 24
        targetSdk = 35
        versionCode = codigoVersion
        versionName = versionWeb
        ndk { abiFilters += abis }
    }

    sourceSets["main"].apply {
        jniLibs.srcDir(File(movil, "jniLibs"))
        assets.srcDir(File(movil, "assets"))
    }

    // Las migraciones de la base traen «_journal.json»: por omisión Android deja fuera los
    // archivos que empiezan con «_», así que se quita esa regla.
    androidResources {
        ignoreAssetsPattern = "!.svn:!.git:!.ds_store:!*.scc:!CVS:!thumbs.db:!picasa.ini:!*~"
    }

    // Node + ICU pesan ~90 MB por procesador: comprimidos en el APK bajan mucho la descarga, y
    // así Android los extrae a la carpeta de librerías, desde donde se puede ejecutar Node.
    packaging { jniLibs { useLegacyPackaging = true } }

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
