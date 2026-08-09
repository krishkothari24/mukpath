const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Everything below is only needed to run the app in a browser via
// `npm run web`. The pilot ships to iOS and Android; web is a dev
// convenience (it's the only way to see the app without Xcode or a phone).
//
// expo-sqlite's web build is WebAssembly and its storage layer needs
// SharedArrayBuffer, which browsers expose only to cross-origin-isolated
// pages — hence the COOP/COEP headers on the dev server.
config.resolver.assetExts.push('wasm');

config.server.enhanceMiddleware = (middleware) => (req, res, next) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
  return middleware(req, res, next);
};

module.exports = config;
