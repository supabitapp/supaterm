const { withEntitlementsPlist } = require("expo/config-plugins");

module.exports = function withoutIosPersonalTeamCapabilities(config) {
  return withEntitlementsPlist(config, (modConfig) => {
    delete modConfig.modResults["com.apple.security.application-groups"];
    delete modConfig.modResults["aps-environment"];
    return modConfig;
  });
};
