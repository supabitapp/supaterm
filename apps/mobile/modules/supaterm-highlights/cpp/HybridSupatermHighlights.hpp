#pragma once

#include "HybridSupatermHighlightsSpec.hpp"

namespace margelo::nitro::supatermhighlights {

class HybridSupatermHighlights : public HybridSupatermHighlightsSpec {
public:
  HybridSupatermHighlights() : HybridObject(TAG) {}

  std::optional<std::shared_ptr<ArrayBuffer>> tokenize(SourceText source,
                                                       double language) override;
};

} // namespace margelo::nitro::supatermhighlights
