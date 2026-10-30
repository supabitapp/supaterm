#ifndef Supaterm_HIGHLIGHTS_H
#define Supaterm_HIGHLIGHTS_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

int64_t supaterm_highlights_tokenize(const uint8_t* source, size_t length, uint8_t language,
                               const uint32_t** records);

#ifdef __cplusplus
}
#endif

#endif
