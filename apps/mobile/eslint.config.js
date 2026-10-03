// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    // `._*` are AppleDouble resource forks macOS writes on non-APFS volumes.
    ignores: ['node_modules/*', '.expo/*', 'dist/*', '**/._*'],
  },
]);
