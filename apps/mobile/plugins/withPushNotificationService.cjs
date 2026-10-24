"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const {
  withDangerousMod,
  withEntitlementsPlist,
  withInfoPlist,
  withXcodeProject,
} = require("expo/config-plugins");

const expoRequire = createRequire(require.resolve("expo/config-plugins"));
const configRequire = createRequire(expoRequire.resolve("@expo/config-plugins"));
const plist = configRequire("@expo/plist").default;

const TARGET_NAME = "SupatermNotificationService";
const MODULE_ROOT = "modules/supaterm-push";

function sourceFiles(projectRoot) {
  const root = path.join(projectRoot, MODULE_ROOT);
  const core = path.join(root, "Sources/SupatermPushCore");
  return [
    {
      name: "NotificationService.swift",
      path: path.join(root, "extension/NotificationService.swift"),
    },
    ...fs
      .readdirSync(core)
      .filter((file) => file.endsWith(".swift"))
      .sort()
      .map((name) => ({ name, path: path.join(core, name) })),
  ];
}

const unquote = (value) => value?.replaceAll('"', "");

function findGroup(project) {
  const groups = project.hash.project.objects.PBXGroup;
  const entry = Object.entries(groups).find(
    ([id, group]) => !id.endsWith("_comment") && unquote(group.path) === TARGET_NAME,
  );
  if (entry) return entry[1];
  const added = project.addPbxGroup([], TARGET_NAME, TARGET_NAME);
  project.addToPbxGroup(added.uuid, project.getFirstProject().firstProject.mainGroup);
  return added.pbxGroup;
}

function addGroupFile(project, group, name) {
  const objects = project.hash.project.objects;
  const id = project.generateUuid();
  objects.PBXFileReference[id] = {
    isa: "PBXFileReference",
    lastKnownFileType: "sourcecode.swift",
    name: `"${name}"`,
    path: `"${name}"`,
    sourceTree: '"<group>"',
  };
  objects.PBXFileReference[`${id}_comment`] = name;
  group.children.push({ value: id, comment: name });
}

/** Keeps the target's Sources phase equal to the module's Swift files across repeated prebuilds. */
function reconcileSources(project, targetId, sources) {
  const objects = project.hash.project.objects;
  const group = findGroup(project);
  const names = sources.map((source) => source.name);
  // Info.plist and the entitlements are build-setting paths and need no reference. A reference
  // would also be picked up by other extension plugins, whose `addFile` reuses any same-path file.
  for (const name of names) {
    const present = group.children.some(
      (child) => unquote(objects.PBXFileReference[child.value]?.path) === name,
    );
    if (!present) addGroupFile(project, group, name);
  }
  const references = new Map(
    group.children.map((child) => [
      unquote(objects.PBXFileReference[child.value]?.path),
      child.value,
    ]),
  );
  const sourcesPhase = objects.PBXNativeTarget[targetId].buildPhases.find(
    (phase) => objects.PBXSourcesBuildPhase?.[phase.value],
  );
  const phase = sourcesPhase
    ? objects.PBXSourcesBuildPhase[sourcesPhase.value]
    : project.addBuildPhase([], "PBXSourcesBuildPhase", "Sources", targetId).buildPhase;
  const previous = new Map(
    phase.files.map((file) => [objects.PBXBuildFile[file.value]?.fileRef, file]),
  );
  phase.files = names.map((name) => {
    const fileRef = references.get(name);
    const existing = previous.get(fileRef);
    if (existing) return existing;
    const id = project.generateUuid();
    objects.PBXBuildFile[id] = { isa: "PBXBuildFile", fileRef, fileRef_comment: name };
    objects.PBXBuildFile[`${id}_comment`] = `${name} in Sources`;
    return { value: id, comment: `${name} in Sources` };
  });
}

/** EAS reads this to provision the extension's bundle identifier and capabilities. */
function withEasAppExtension(config, extension) {
  const eas = config.extra?.eas ?? {};
  const build = eas.build ?? {};
  const experimental = build.experimental ?? {};
  const ios = experimental.ios ?? {};
  const appExtensions = (ios.appExtensions ?? []).filter((item) => item.targetName !== TARGET_NAME);
  config.extra = {
    ...config.extra,
    eas: {
      ...eas,
      build: {
        ...build,
        experimental: {
          ...experimental,
          ios: { ...ios, appExtensions: [...appExtensions, extension] },
        },
      },
    },
  };
  return config;
}

/**
 * Adds the notification service extension that decrypts Supaterm pushes. The app and the
 * extension share a dedicated Keychain group for recipient keys and the App Group for the
 * replay ledger and the hide-content toggle. The app's first Keychain group stays its own,
 * so expo-secure-store items and the gateway owner token are not readable by the extension.
 */
module.exports = function withPushNotificationService(config) {
  const bundleIdentifier = config.ios?.bundleIdentifier;
  if (!bundleIdentifier) throw new Error("withPushNotificationService needs ios.bundleIdentifier.");
  const extensionBundleIdentifier = `${bundleIdentifier}.notification-service`;
  const appKeychainGroup = `$(AppIdentifierPrefix)${bundleIdentifier}`;
  const sharedKeychainGroup = `$(AppIdentifierPrefix)${bundleIdentifier}.push`;
  const appGroup = `group.${bundleIdentifier}`;
  const extensionEntitlements = {
    "keychain-access-groups": [sharedKeychainGroup],
    "com.apple.security.application-groups": [appGroup],
  };

  config = withEasAppExtension(config, {
    targetName: TARGET_NAME,
    bundleIdentifier: extensionBundleIdentifier,
    entitlements: extensionEntitlements,
  });
  config = withInfoPlist(config, (modConfig) => {
    modConfig.modResults.SupatermPushKeychainGroup = sharedKeychainGroup;
    modConfig.modResults.SupatermPushAppKeychainGroup = appKeychainGroup;
    modConfig.modResults.SupatermPushAppGroup = appGroup;
    return modConfig;
  });
  config = withEntitlementsPlist(config, (modConfig) => {
    const entitlements = modConfig.modResults;
    const keychainGroups = entitlements["keychain-access-groups"] ?? [];
    entitlements["keychain-access-groups"] = [
      ...(keychainGroups.length === 0 ? [appKeychainGroup] : keychainGroups),
      ...(keychainGroups.includes(sharedKeychainGroup) ? [] : [sharedKeychainGroup]),
    ];
    const appGroups = entitlements["com.apple.security.application-groups"] ?? [];
    entitlements["com.apple.security.application-groups"] = [...new Set([...appGroups, appGroup])];
    return modConfig;
  });
  config = withDangerousMod(config, [
    "ios",
    (modConfig) => {
      const target = path.join(modConfig.modRequest.platformProjectRoot, TARGET_NAME);
      fs.mkdirSync(target, { recursive: true });
      const sources = sourceFiles(modConfig.modRequest.projectRoot);
      const names = new Set(sources.map((source) => source.name));
      for (const file of fs.readdirSync(target)) {
        if (file.endsWith(".swift") && !names.has(file)) fs.unlinkSync(path.join(target, file));
      }
      for (const source of sources) fs.copyFileSync(source.path, path.join(target, source.name));
      fs.writeFileSync(
        path.join(target, "Info.plist"),
        plist.build({
          CFBundleDevelopmentRegion: "$(DEVELOPMENT_LANGUAGE)",
          CFBundleDisplayName: modConfig.name,
          CFBundleExecutable: "$(EXECUTABLE_NAME)",
          CFBundleIdentifier: "$(PRODUCT_BUNDLE_IDENTIFIER)",
          CFBundleInfoDictionaryVersion: "6.0",
          CFBundleName: "$(PRODUCT_NAME)",
          CFBundlePackageType: "$(PRODUCT_BUNDLE_PACKAGE_TYPE)",
          CFBundleShortVersionString: "$(MARKETING_VERSION)",
          CFBundleVersion: "$(CURRENT_PROJECT_VERSION)",
          SupatermPushKeychainGroup: sharedKeychainGroup,
          SupatermPushAppGroup: appGroup,
          NSExtension: {
            NSExtensionPointIdentifier: "com.apple.usernotifications.service",
            NSExtensionPrincipalClass: "$(PRODUCT_MODULE_NAME).NotificationService",
          },
        }),
      );
      fs.writeFileSync(
        path.join(target, `${TARGET_NAME}.entitlements`),
        plist.build(extensionEntitlements),
      );
      return modConfig;
    },
  ]);
  return withXcodeProject(config, (modConfig) => {
    const project = modConfig.modResults;
    const objects = project.hash.project.objects;
    let entry = Object.entries(objects.PBXNativeTarget).find(
      ([id, target]) => !id.endsWith("_comment") && unquote(target.name) === TARGET_NAME,
    );
    if (!entry) {
      const target = project.addTarget(
        TARGET_NAME,
        "app_extension",
        TARGET_NAME,
        extensionBundleIdentifier,
      );
      project.addBuildPhase([], "PBXFrameworksBuildPhase", "Frameworks", target.uuid);
      project.addBuildPhase([], "PBXResourcesBuildPhase", "Resources", target.uuid);
      objects.PBXTargetDependency ??= {};
      objects.PBXContainerItemProxy ??= {};
      project.addTargetDependency(project.getFirstTarget().uuid, [target.uuid]);
      entry = [target.uuid, target.pbxNativeTarget];
    }
    reconcileSources(project, entry[0], sourceFiles(modConfig.modRequest.projectRoot));
    const configurations =
      objects.XCConfigurationList[entry[1].buildConfigurationList].buildConfigurations;
    for (const reference of configurations) {
      Object.assign(objects.XCBuildConfiguration[reference.value].buildSettings, {
        APPLICATION_EXTENSION_API_ONLY: "YES",
        CODE_SIGN_STYLE: "Automatic",
        CODE_SIGN_ENTITLEMENTS: `"${TARGET_NAME}/${TARGET_NAME}.entitlements"`,
        CURRENT_PROJECT_VERSION: `"${modConfig.ios?.buildNumber ?? "1"}"`,
        DEVELOPMENT_TEAM: modConfig.ios?.appleTeamId,
        GENERATE_INFOPLIST_FILE: "NO",
        INFOPLIST_FILE: `"${TARGET_NAME}/Info.plist"`,
        IPHONEOS_DEPLOYMENT_TARGET: "18.0",
        MARKETING_VERSION: `"${modConfig.version}"`,
        PRODUCT_BUNDLE_IDENTIFIER: `"${extensionBundleIdentifier}"`,
        PRODUCT_NAME: `"${TARGET_NAME}"`,
        SKIP_INSTALL: "YES",
        SWIFT_VERSION: "5.0",
        TARGETED_DEVICE_FAMILY: '"1,2"',
      });
    }
    return modConfig;
  });
};
