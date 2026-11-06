#pragma once

#include <NitroModules/JSIConverter.hpp>
#include <string>

#include "Utf16ToUtf8.hpp"

namespace margelo::nitro::supatermhighlights {

/** A JS string as the UTF-8 bytes the lexer reads. */
struct SourceText {
  std::string utf8;
};

} // namespace margelo::nitro::supatermhighlights

namespace margelo::nitro {

// Hermes' own utf8() is several times slower than this for strings it stores as
// UTF-16, which is any string with one non-ASCII character in it.
template <>
struct JSIConverter<supatermhighlights::SourceText> final {
  static inline supatermhighlights::SourceText fromJSI(jsi::Runtime& runtime, const jsi::Value& arg) {
    supatermhighlights::SourceText source;
    auto read = [&source](bool ascii, const void* data, size_t length) {
      if (ascii) {
        source.utf8.append(static_cast<const char*>(data), length);
      } else {
        supatermhighlights::appendUtf16AsUtf8(source.utf8, static_cast<const char16_t*>(data), length);
      }
    };
    arg.asString(runtime).getStringData(runtime, read);
    return source;
  }
  static inline jsi::Value toJSI(jsi::Runtime& runtime, const supatermhighlights::SourceText& arg) {
    return jsi::String::createFromUtf8(runtime, arg.utf8);
  }
  static inline bool canConvert(jsi::Runtime&, const jsi::Value& value) {
    return value.isString();
  }
};

} // namespace margelo::nitro
