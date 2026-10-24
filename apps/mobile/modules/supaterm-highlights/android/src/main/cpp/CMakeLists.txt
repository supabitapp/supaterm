cmake_minimum_required(VERSION 3.22.1)

project(supatermhighlights LANGUAGES C)

set(SUPATERM_HIGHLIGHTS_ROOT "${CMAKE_CURRENT_SOURCE_DIR}/../../../..")

add_library(
  supatermhighlights SHARED
  supaterm_highlights_jni.c
  "${SUPATERM_HIGHLIGHTS_ROOT}/cpp/supaterm_highlights.c"
  "${SUPATERM_HIGHLIGHTS_ROOT}/Vendor/highlights/highlights.c"
  "${SUPATERM_HIGHLIGHTS_ROOT}/Vendor/wasm2c/wasm-rt-impl.c"
  "${SUPATERM_HIGHLIGHTS_ROOT}/Vendor/wasm2c/wasm-rt-mem-impl.c"
)

target_include_directories(
  supatermhighlights
  PRIVATE "${SUPATERM_HIGHLIGHTS_ROOT}/cpp" "${SUPATERM_HIGHLIGHTS_ROOT}/Vendor"
          "${SUPATERM_HIGHLIGHTS_ROOT}/Vendor/highlights" "${SUPATERM_HIGHLIGHTS_ROOT}/Vendor/wasm2c"
)

# Plain malloc memory with explicit bounds checks: no guard-page signal
# handlers competing with ART's.
target_compile_definitions(
  supatermhighlights PRIVATE WASM_RT_USE_MMAP=0 WASM_RT_MEMCHECK_BOUNDS_CHECK=1
                       WASM_RT_SKIP_SIGNAL_RECOVERY=1
)

# The lexers are generated code; keep them fast in debug builds too.
target_compile_options(supatermhighlights PRIVATE -O2)

target_link_options(
  supatermhighlights PRIVATE "-Wl,-z,common-page-size=16384" "-Wl,-z,max-page-size=16384"
)
