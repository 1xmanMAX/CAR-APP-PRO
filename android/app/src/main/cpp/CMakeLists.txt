# Puente mínimo entre la app y Node.js (libnode.so de nodejs-mobile): arranca Node con los
# argumentos que le pasa Kotlin y manda su salida al logcat.
cmake_minimum_required(VERSION 3.22.1)
project(puente CXX)

set(LIBNODE ${CMAKE_SOURCE_DIR}/../../../movil/libnode)
add_library(node SHARED IMPORTED)
set_target_properties(node PROPERTIES IMPORTED_LOCATION ${LIBNODE}/bin/${ANDROID_ABI}/libnode.so)

add_library(puente SHARED puente.cpp)
target_include_directories(puente PRIVATE ${LIBNODE}/include/node)
find_library(log-lib log)
target_link_libraries(puente node ${log-lib})
