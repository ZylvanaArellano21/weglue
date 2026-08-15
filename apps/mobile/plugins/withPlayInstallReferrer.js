const {
  withAppBuildGradle,
  withDangerousMod,
  withMainApplication,
  createRunOncePlugin,
} = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

// ─── Feature 1 — Google Play Install Referrer (Android-only, free, no
// third-party attribution vendor) ────────────────────────────────────────
//
// Deliberately NOT a community npm wrapper: several exist, but this repo's
// task explicitly excludes paid attribution services, and at least one
// popular wrapper is maintained by an attribution-vendor employee — auditing
// its native source wasn't possible in this environment, so this plugin
// instead wires Google's own `com.android.installreferrer` library (the
// exact "free Google Play Install Referrer API" the spec names) directly:
// one Gradle dependency, one small Kotlin module, zero third parties.
//
// This is config-plugin-applied at `expo prebuild` time (this repo has no
// checked-in android/ folder — fully managed workflow), so it is NOT
// OTA-eligible: any change here requires a new native Android build.

const INSTALL_REFERRER_DEP = 'com.android.installreferrer:installreferrer:2.2';

const MODULE_KT = `package com.weglue.app

import com.android.installreferrer.api.InstallReferrerClient
import com.android.installreferrer.api.InstallReferrerStateListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * Feature 1 — reads the Google Play Install Referrer exactly once per
 * process lifetime request. Wraps Google's own InstallReferrerClient
 * (com.android.installreferrer), not a third-party attribution SDK.
 *
 * Resolves the raw referrer string (e.g. "invite_token=<opaque token>") on
 * success, or null on ANY failure (not installed via Play, feature
 * unsupported, service unavailable, disconnected before response, or any
 * other InstallReferrerClient response code). A null resolution is not an
 * error — the JS side treats it identically to "no referrer": normal Home
 * flow. This is required behavior (Feature 1 acceptance criterion 3:
 * "missing, invalid, or separately installed referrers use the normal Home
 * flow"), so this module must never reject for an ordinary "no referrer"
 * case — only a genuinely unexpected exception rejects.
 */
class PlayInstallReferrerModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName() = "PlayInstallReferrer"

  @ReactMethod
  fun getInstallReferrer(promise: Promise) {
    val context = reactApplicationContext
    val client = InstallReferrerClient.newBuilder(context).build()
    var settled = false

    fun finish(value: String?) {
      if (settled) return
      settled = true
      promise.resolve(value)
      try {
        client.endConnection()
      } catch (_: Exception) {
        // Already disconnected — nothing further to do.
      }
    }

    try {
      client.startConnection(object : InstallReferrerStateListener {
        override fun onInstallReferrerSetupFinished(responseCode: Int) {
          if (responseCode == InstallReferrerClient.InstallReferrerResponse.OK) {
            try {
              val response = client.installReferrer
              finish(response.installReferrer)
            } catch (_: Exception) {
              finish(null)
            }
          } else {
            // FEATURE_NOT_SUPPORTED, SERVICE_UNAVAILABLE, DEVELOPER_ERROR,
            // SERVICE_DISCONNECTED, etc. — all resolve null, never reject.
            finish(null)
          }
        }

        override fun onInstallReferrerServiceDisconnected() {
          finish(null)
        }
      })
    } catch (e: Exception) {
      // The Play Store app itself isn't installed on this device, or some
      // other environment issue — same "no referrer" outcome.
      finish(null)
    }
  }
}
`;

const PACKAGE_KT = `package com.weglue.app

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class PlayInstallReferrerPackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
    listOf(PlayInstallReferrerModule(reactContext))

  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> =
    emptyList()
}
`;

function withInstallReferrerGradleDependency(config) {
  return withAppBuildGradle(config, (config) => {
    if (config.modResults.contents.includes(INSTALL_REFERRER_DEP)) {
      return config;
    }
    config.modResults.contents = config.modResults.contents.replace(
      /dependencies\s*\{/,
      `dependencies {\n    implementation("${INSTALL_REFERRER_DEP}")`,
    );
    return config;
  });
}

function withInstallReferrerNativeFiles(config) {
  return withDangerousMod(config, [
    'android',
    async (config) => {
      const pkgDir = path.join(
        config.modRequest.platformProjectRoot,
        'app/src/main/java/com/weglue/app',
      );
      fs.mkdirSync(pkgDir, { recursive: true });
      fs.writeFileSync(path.join(pkgDir, 'PlayInstallReferrerModule.kt'), MODULE_KT);
      fs.writeFileSync(path.join(pkgDir, 'PlayInstallReferrerPackage.kt'), PACKAGE_KT);
      return config;
    },
  ]);
}

function withInstallReferrerPackageRegistration(config) {
  return withMainApplication(config, (config) => {
    const contents = config.modResults.contents;
    if (contents.includes('PlayInstallReferrerPackage()')) {
      return config;
    }
    // Expo SDK 54 / RN 0.81's generated MainApplication.kt (verified via a
    // real `expo prebuild --platform android` run against this exact
    // project, not assumed from an older SDK's docs):
    //
    //   override fun getPackages(): List<ReactPackage> =
    //       PackageList(this).packages.apply {
    //         // Packages that cannot be autolinked yet can be added manually here, for example:
    //         // add(MyReactNativePackage())
    //       }
    //
    // i.e. `PackageList(this).packages.apply { ... }`, not the older
    // `val packages = PackageList(this).packages` + `packages.add(...)` shape.
    // Insert directly inside the `.apply {` block, matching the file's own
    // commented example.
    if (/PackageList\(this\)\.packages\.apply\s*\{/.test(contents)) {
      config.modResults.contents = contents.replace(
        /(PackageList\(this\)\.packages\.apply\s*\{)/,
        `$1\n              add(PlayInstallReferrerPackage())`,
      );
    } else {
      throw new Error(
        'withPlayInstallReferrer: could not find the expected `PackageList(this).packages.apply { }` ' +
          'block in MainApplication.kt to register PlayInstallReferrerPackage. Inspect the ' +
          'generated file after `expo prebuild` and update this plugin to match.',
      );
    }
    return config;
  });
}

const withPlayInstallReferrer = (config) => {
  config = withInstallReferrerGradleDependency(config);
  config = withInstallReferrerNativeFiles(config);
  config = withInstallReferrerPackageRegistration(config);
  return config;
};

module.exports = createRunOncePlugin(withPlayInstallReferrer, 'withPlayInstallReferrer', '1.0.0');
