import type { ExpoConfig } from "expo/config";
import { crashReportingEndpoint } from "./src/lib/crashReportingConfig.ts";

import { BRAND_ASSET_PATHS } from "../../scripts/lib/brand-assets.ts";
import { loadRepoEnv } from "../../scripts/lib/public-config.ts";

type AppVariant = "development" | "preview" | "production";

const repoEnv = loadRepoEnv();
const crashEndpointUrl = crashReportingEndpoint(repoEnv.SUPATERM_MOBILE_CRASH_REPORT_URL);
Object.assign(process.env, repoEnv);

const APP_VARIANT = resolveAppVariant(repoEnv.APP_VARIANT);

process.env.EXPO_PUBLIC_APP_VARIANT = APP_VARIANT;
const isIosPersonalTeamBuild = repoEnv.SUPATERM_IOS_PERSONAL_TEAM === "1";
const runtimeVersionPolicy =
  process.env.MOBILE_VERSION_POLICY ??
  (APP_VARIANT === "development" ? "appVersion" : "fingerprint");

const personalTeamBundleIdentifier = repoEnv.SUPATERM_IOS_PERSONAL_TEAM_BUNDLE_ID?.trim();
const IOS_BUNDLE_IDENTIFIER_PATTERN = /^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;

const fromRepoRoot = (relativePath: string) => `../../${relativePath}`;
const androidAdaptiveForeground = "./assets/android-icon-foreground.png";
const androidAdaptiveBackgroundColor = "#151B17";

if (
  isIosPersonalTeamBuild &&
  (!personalTeamBundleIdentifier ||
    !IOS_BUNDLE_IDENTIFIER_PATTERN.test(personalTeamBundleIdentifier))
) {
  throw new Error(
    "SUPATERM_IOS_PERSONAL_TEAM_BUNDLE_ID must be a reverse-DNS identifier such as com.example.supaterm when SUPATERM_IOS_PERSONAL_TEAM=1.",
  );
}

const DEVELOPMENT_ASSETS = {
  appIcon: fromRepoRoot(BRAND_ASSET_PATHS.developmentIosIconPng),
  iosIcon: fromRepoRoot(BRAND_ASSET_PATHS.developmentIconComposerProject),
  splashIcon: fromRepoRoot(BRAND_ASSET_PATHS.developmentIosIconPng),
  androidIcon: "./assets/android-icon-dev.png",
  androidAdaptiveForeground,
  androidAdaptiveBackgroundColor,
  androidAdaptiveBackgroundImage: "./assets/android-icon-background-dev.png",
  androidSplashIcon: "./assets/android-splash-icon-dev.png",
} as const;

const PREVIEW_ASSETS = {
  appIcon: fromRepoRoot(BRAND_ASSET_PATHS.nightlyIosIconPng),
  iosIcon: fromRepoRoot(BRAND_ASSET_PATHS.nightlyIconComposerProject),
  splashIcon: fromRepoRoot(BRAND_ASSET_PATHS.nightlyIosIconPng),
  androidIcon: "./assets/android-icon-nightly.png",
  androidAdaptiveForeground,
  androidAdaptiveBackgroundColor,
  androidAdaptiveBackgroundImage: "./assets/android-icon-background-nightly.png",
  androidSplashIcon: "./assets/android-splash-icon-nightly.png",
} as const;

const RELEASE_ASSETS = {
  appIcon: fromRepoRoot(BRAND_ASSET_PATHS.productionIosIconPng),
  iosIcon: fromRepoRoot(BRAND_ASSET_PATHS.productionIconComposerProject),
  splashIcon: fromRepoRoot(BRAND_ASSET_PATHS.productionIosIconPng),
  androidIcon: "./assets/android-icon-prod.png",
  androidAdaptiveForeground,
  androidAdaptiveBackgroundColor,
  androidAdaptiveBackgroundImage: "./assets/android-icon-background-prod.png",
  androidSplashIcon: "./assets/android-splash-icon-prod.png",
} as const;

const VARIANT_CONFIG = {
  development: {
    appName: "Supaterm Dev",
    scheme: "supaterm-dev",
    iosBundleIdentifier: "com.supaterm.mobile.dev",
    androidPackage: "com.supaterm.mobile.dev",
    assets: DEVELOPMENT_ASSETS,
  },
  preview: {
    appName: "Supaterm Preview",
    scheme: "supaterm-preview",
    iosBundleIdentifier: "com.supaterm.mobile.preview",
    androidPackage: "com.supaterm.mobile.preview",
    assets: PREVIEW_ASSETS,
  },
  production: {
    appName: "Supaterm",
    scheme: "supaterm",
    iosBundleIdentifier: "com.supaterm.mobile",
    androidPackage: "com.supaterm.mobile",
    assets: RELEASE_ASSETS,
  },
} as const;

function resolveAppVariant(value: string | undefined): AppVariant {
  switch (value) {
    case "development":
    case "preview":
    case "production":
      return value;
    default:
      return "production";
  }
}

const variant = VARIANT_CONFIG[APP_VARIANT];
const iosBundleIdentifier = isIosPersonalTeamBuild
  ? personalTeamBundleIdentifier!
  : variant.iosBundleIdentifier;

const codeFonts = {
  regular: "@expo-google-fonts/jetbrains-mono/400Regular/JetBrainsMono_400Regular.ttf",
  medium: "@expo-google-fonts/jetbrains-mono/500Medium/JetBrainsMono_500Medium.ttf",
  bold: "@expo-google-fonts/jetbrains-mono/700Bold/JetBrainsMono_700Bold.ttf",
} as const;

const widgetsPlugin: NonNullable<ExpoConfig["plugins"]>[number] = [
  "expo-widgets",
  {
    bundleIdentifier: `${iosBundleIdentifier}.widgets`,
    groupIdentifier: `group.${iosBundleIdentifier}`,
    enableAndroid: true,
    widgets: [
      {
        name: "SubscriptionUsage",
        displayName: "Subscription usage",
        description: "Subscription quotas from your connected Supaterm environments.",
        ios: {
          configuration: {
            title: "Subscription usage",
            description:
              "Both shows Session and Weekly when available. The Lock Screen shows the tightest selected limit.",
            parameters: {
              codexPeriod: {
                title: "Codex limits",
                type: "enum",
                default: "auto",
                values: [
                  { name: "Both", value: "auto" },
                  { name: "Session", value: "session" },
                  { name: "Weekly", value: "weekly" },
                ],
              },
              claudePeriod: {
                title: "Claude limits",
                type: "enum",
                default: "auto",
                values: [
                  { name: "Both", value: "auto" },
                  { name: "Session", value: "session" },
                  { name: "Weekly", value: "weekly" },
                ],
              },
            },
          },
          supportedFamilies: [
            "systemSmall",
            "systemMedium",
            "systemLarge",
            "systemExtraLarge",
            "accessoryRectangular",
          ],
        },
        android: {
          minWidth: 250,
          minHeight: 180,
          targetCellWidth: 4,
          targetCellHeight: 3,
          resizeMode: "both",

          initialLayout: "./src/widgets/SubscriptionUsage.android.tsx",
        },
      },
    ],
  },
];

const sharingPlugin: NonNullable<ExpoConfig["plugins"]>[number] = [
  "expo-sharing",
  {
    ios: {
      enabled: !isIosPersonalTeamBuild,
      extensionBundleIdentifier: `${iosBundleIdentifier}.sharing`,
      appGroupId: `group.${iosBundleIdentifier}`,
      activationRule: {
        supportsText: true,
        supportsWebUrlWithMaxCount: 1,
        supportsImageWithMaxCount: 8,
        supportsMovieWithMaxCount: 8,
        supportsFileWithMaxCount: 8,
      },
    },
    android: {
      enabled: true,
      singleShareMimeTypes: ["*/*"],
      multipleShareMimeTypes: ["*/*"],
    },
  },
];

const config: ExpoConfig = {
  name: variant.appName,
  slug: "supaterm",
  platforms: ["ios", "android"],
  scheme: variant.scheme,
  version: "26.10.6",
  runtimeVersion: {
    policy: runtimeVersionPolicy,
  },
  orientation: "portrait",
  icon: variant.assets.appIcon,
  userInterfaceStyle: "automatic",
  updates: {
    enabled: repoEnv.SUPATERM_MOBILE_UPDATES_ENABLED !== "0",
    url: "https://u.expo.dev/c96e633c-2940-4aab-a40a-44777a9600c6",
    checkAutomatically: "ON_LOAD",
    fallbackToCacheTimeout: 0,
  },
  ios: {
    icon: variant.assets.iosIcon,
    supportsTablet: true,
    requireFullScreen: process.env.SUPATERM_SHOWCASE_CAPTURE_BUILD === "1",
    bundleIdentifier: iosBundleIdentifier,

    appleTeamId: "9ZLSJ2GN2B",
    entitlements: {
      "keychain-access-groups": [`$(AppIdentifierPrefix)${variant.iosBundleIdentifier}`],
    },
    infoPlist: {
      UIViewControllerBasedStatusBarAppearance: true,
      UISupportedInterfaceOrientations: [
        "UIInterfaceOrientationPortrait",
        "UIInterfaceOrientationLandscapeLeft",
        "UIInterfaceOrientationLandscapeRight",
      ],
      NSAppTransportSecurity: {
        NSAllowsArbitraryLoads: true,
      },
      NSLocalNetworkUsageDescription:
        "Allow Supaterm to connect to Supaterm servers on your local network or tailnet.",
      NSPhotoLibraryAddUsageDescription: "Allow Supaterm to save images to your photo library.",

      UIBackgroundModes: ["audio"],
      ITSAppUsesNonExemptEncryption: false,
      ...(process.env.SUPATERM_SHOWCASE_CAPTURE_BUILD === "1"
        ? {
            EXDevMenuShowsAtLaunch: false,
            EXDevMenuIsOnboardingFinished: true,
            EXDevMenuShowFloatingActionButton: false,
          }
        : {}),

      ...(process.env.SUPATERM_SHOWCASE_CAPTURE_BUILD === "1"
        ? {
            "UISupportedInterfaceOrientations~ipad": [
              "UIInterfaceOrientationPortrait",
              "UIInterfaceOrientationPortraitUpsideDown",
              "UIInterfaceOrientationLandscapeLeft",
              "UIInterfaceOrientationLandscapeRight",
            ],
          }
        : {}),
    },
  },
  android: {
    icon: variant.assets.androidIcon,
    package: variant.androidPackage,
    versionCode: 3,
    adaptiveIcon: {
      backgroundColor: variant.assets.androidAdaptiveBackgroundColor,
      backgroundImage: variant.assets.androidAdaptiveBackgroundImage,
      foregroundImage: variant.assets.androidAdaptiveForeground,
    },

    predictiveBackGestureEnabled: true,

    blockedPermissions: ["android.permission.ACTIVITY_RECOGNITION"],
  },
  web: {
    favicon: variant.assets.appIcon,
  },
  plugins: [
    "expo-asset",
    "react-native-pdf-jsi",
    [
      "expo-font",
      {
        ios: {
          fonts: [codeFonts.regular, codeFonts.medium, codeFonts.bold],
        },
        android: {
          fonts: [
            {
              fontFamily: "JetBrainsMono",
              fontDefinitions: [
                { path: codeFonts.regular, weight: 400 },
                { path: codeFonts.medium, weight: 500 },
                { path: codeFonts.bold, weight: 700 },
              ],
            },
          ],
        },
      },
    ],
    "expo-secure-store",
    "expo-sqlite",
    ...(isIosPersonalTeamBuild
      ? [sharingPlugin]
      : ["./plugins/withShareExtensionDisplayName.cjs", sharingPlugin]),
    [
      "expo-quick-actions",
      {
        androidIcons: {
          shortcut_icon: {
            foregroundImage: variant.assets.androidAdaptiveForeground,
            backgroundColor: variant.assets.androidAdaptiveBackgroundColor,
            backgroundImage: variant.assets.androidAdaptiveBackgroundImage,
          },
        },
      },
    ],
    [
      "expo-audio",
      {
        microphonePermission: "Allow Supaterm to use your microphone for voice input.",
        recordAudioAndroid: false,
        enableBackgroundPlayback: false,
        enableBackgroundRecording: false,
      },
    ],
    [
      "expo-camera",
      {
        cameraPermission: "Allow Supaterm to access your camera so you can scan pairing QR codes.",
        microphonePermission: false,
        barcodeScannerEnabled: true,
        recordAudioAndroid: false,
      },
    ],
    ["expo-image-picker", { photosPermission: false, microphonePermission: false }],
    [
      "expo-splash-screen",
      {
        image: variant.assets.splashIcon,
        resizeMode: "contain",
        backgroundColor: "#ffffff",
        imageWidth: 220,
        dark: {
          image: variant.assets.splashIcon,
          backgroundColor: "#0a0a0a",
        },
        android: {
          image: variant.assets.androidSplashIcon,
          backgroundColor: variant.assets.androidAdaptiveBackgroundColor,
          imageWidth: 288,
          dark: {
            image: variant.assets.androidSplashIcon,
            backgroundColor: variant.assets.androidAdaptiveBackgroundColor,
          },
        },
      },
    ],
    [
      "expo-build-properties",
      {
        android: {
          minSdkVersion: 24,

          extraProguardRules: [
            "-dontwarn kotlin.MustUseReturnValues",
            "-keep class * extends androidx.work.InputMerger { <init>(); }",
          ].join("\n"),
        },
        ios: {
          deploymentTarget: "18.0",
        },
      },
    ],
    "./plugins/withIosCocoaPodsUuidCache.cjs",

    ["expo-sensors", { motionPermission: false }],
    ...(!isIosPersonalTeamBuild ? [widgetsPlugin] : []),
    "./plugins/withAndroidNetworkSecurityConfig.cjs",
    "./plugins/withAndroidGradleHeap.cjs",
    "./plugins/withAndroidFbjniVersion.cjs",
    "./plugins/withAndroidInputBackground.cjs",
    "./plugins/withAndroidModernPopupMenu.cjs",
    "./plugins/withAndroidModernAlertDialog.cjs",
    "./plugins/withAndroidPredictiveBackCompat.cjs",
    "./plugins/withAndroidTabletOrientation.cjs",
    ...(isIosPersonalTeamBuild ? ["./plugins/withoutIosPersonalTeamCapabilities.cjs"] : []),
  ],
  extra: {
    appVariant: APP_VARIANT,
    iosPersonalTeamBuild: isIosPersonalTeamBuild,
    crashReporting: { endpointUrl: crashEndpointUrl },
    eas: {
      projectId: "c96e633c-2940-4aab-a40a-44777a9600c6",
      observe: { endpointUrl: crashEndpointUrl ?? "https://observe.invalid" },
    },
  },
  owner: "supabitapp",
  experiments: {
    reactCompiler: true,
  },
};

export default config;
