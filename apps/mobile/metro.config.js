const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");
const fs = require("fs");
const path = require("path");

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, "../..");
const pnpmStore = path.resolve(monorepoRoot, "node_modules/.pnpm");

// pnpm stores packages in a virtual store and links them via symlinks.
// Metro does not reliably follow those symlinks, so we resolve all pnpm
// store packages to their real paths and hand them directly to Metro.
//
// The store can hold MULTIPLE variants of the same package, each bound to a
// different peer React (e.g. @tanstack/react-query bound to react@18 from the
// Next.js web app vs. react@19 for mobile). The mobile app runs React 19, so
// we must always pick the react@19-bound variant. Picking an 18-bound variant
// produces React-18 elements that the Expo Go (React 19) renderer rejects with
// "Objects are not valid as a React child".
const REACT_19 = "react@19.1.0";
const REACT_18 = "react@18.3.1";

// Higher score wins when several store entries map to the same package name.
function variantScore(entry) {
  let score = 0;
  if (entry.includes(REACT_19)) score += 2;
  if (entry.includes(REACT_18)) score -= 2;
  return score;
}

function buildPnpmExtraModules(storeDir) {
  const map = {};
  const scoreByPkg = {};
  const consider = (pkgName, pkgPath, entry) => {
    if (!fs.existsSync(pkgPath)) return;
    const score = variantScore(entry);
    if (!(pkgName in map) || score > scoreByPkg[pkgName]) {
      map[pkgName] = pkgPath;
      scoreByPkg[pkgName] = score;
    }
  };
  try {
    fs.readdirSync(storeDir).forEach((entry) => {
      // pnpm store dir names:
      //   @scope+name@version  (scoped)
      //   name@version         (unscoped)
      const scopedMatch = entry.match(/^(@[^+]+)\+([^@]+)@/);
      const unscopedMatch = !scopedMatch && entry.match(/^([^@][^@]*)@/);

      if (scopedMatch) {
        const pkgName = `${scopedMatch[1]}/${scopedMatch[2]}`;
        const pkgPath = path.join(storeDir, entry, "node_modules", scopedMatch[1], scopedMatch[2]);
        consider(pkgName, pkgPath, entry);
      } else if (unscopedMatch) {
        const pkgName = unscopedMatch[1];
        const pkgPath = path.join(storeDir, entry, "node_modules", pkgName);
        consider(pkgName, pkgPath, entry);
      }
    });
  } catch (_) {}
  return map;
}

const config = getDefaultConfig(projectRoot);

config.watchFolders = [monorepoRoot];

config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(monorepoRoot, "node_modules"),
];

config.resolver.unstable_enableSymlinks = false;
config.resolver.extraNodeModules = buildPnpmExtraModules(pnpmStore);

// ── Force a SINGLE copy of React across the whole bundle ─────────────────────
// extraNodeModules is only a *fallback*, so some package importers were still
// resolving the react@18 variant (from the Next.js web app) and emitting
// React-18 elements that the Expo Go React-19 renderer rejects. resolveRequest
// runs for EVERY import and is authoritative: any `react` (or its jsx runtime)
// import is pinned to the one react@19 copy. Same idea for react-native.
const reactRoot = path.join(pnpmStore, "react@19.1.0", "node_modules", "react");
const reactNativeRoot = config.resolver.extraNodeModules["react-native"];

const FORCED_SINGLETONS = {
  react: reactRoot,
  "react/jsx-runtime": path.join(reactRoot, "jsx-runtime.js"),
  "react/jsx-dev-runtime": path.join(reactRoot, "jsx-dev-runtime.js"),
  "react-native": reactNativeRoot,
};

const defaultResolveRequest = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const forced = FORCED_SINGLETONS[moduleName];
  if (forced) {
    return { type: "sourceFile", filePath: require.resolve(forced) };
  }
  if (defaultResolveRequest) {
    return defaultResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = withNativeWind(config, { input: "./global.css" });
