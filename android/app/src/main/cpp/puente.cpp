// Arranca Node.js dentro del proceso de la app. Node solo puede arrancar una vez por proceso.
#include <jni.h>
#include <android/log.h>
#include <pthread.h>
#include <unistd.h>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

#include "node.h"

struct Salida { int fd; int prioridad; };

// Copia cada línea que escribe Node (console.log / errores) al logcat.
static void* copiar_al_logcat(void* arg) {
    Salida s = *(Salida*)arg;
    delete (Salida*)arg;
    FILE* f = fdopen(s.fd, "r");
    char buf[2048];
    while (f && fgets(buf, sizeof buf, f)) {
        size_t l = strlen(buf);
        if (l && buf[l - 1] == '\n') buf[l - 1] = 0;
        __android_log_write(s.prioridad, "ControlFlotaNode", buf);
    }
    return nullptr;
}

static void redirigir(int destino, int prioridad) {
    int tubo[2];
    if (pipe(tubo) != 0) return;
    dup2(tubo[1], destino);
    close(tubo[1]);
    pthread_t hilo;
    if (pthread_create(&hilo, nullptr, copiar_al_logcat, new Salida{tubo[0], prioridad}) == 0) pthread_detach(hilo);
}

extern "C" JNIEXPORT jint JNICALL
Java_pe_controlflota_app_Nodo_arrancar(JNIEnv* env, jclass, jobjectArray argumentos) {
    setvbuf(stdout, nullptr, _IONBF, 0);
    setvbuf(stderr, nullptr, _IONBF, 0);
    redirigir(STDOUT_FILENO, ANDROID_LOG_INFO);
    redirigir(STDERR_FILENO, ANDROID_LOG_WARN);

    // Node exige que los argumentos estén seguidos en un solo bloque de memoria (y que no se liberen).
    jsize n = env->GetArrayLength(argumentos);
    std::vector<std::string> textos;
    size_t total = 0;
    for (jsize i = 0; i < n; i++) {
        auto s = (jstring)env->GetObjectArrayElement(argumentos, i);
        const char* c = env->GetStringUTFChars(s, nullptr);
        textos.emplace_back(c);
        env->ReleaseStringUTFChars(s, c);
        env->DeleteLocalRef(s);
        total += textos.back().size() + 1;
    }
    char* bloque = (char*)calloc(total, 1);
    std::vector<char*> argv;
    char* p = bloque;
    for (auto& t : textos) {
        memcpy(p, t.c_str(), t.size());
        argv.push_back(p);
        p += t.size() + 1;
    }
    argv.push_back(nullptr);
    return node::Start((int)n, argv.data());
}
