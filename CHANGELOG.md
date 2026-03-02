<!-- markdownlint-disable --><!-- textlint-disable -->

# 📓 Changelog

All notable changes to this project will be documented in this file. See
[Conventional Commits](https://conventionalcommits.org) for commit guidelines.

## [2.0.0](https://github.com/sanity-io/worker-channels/compare/v1.1.0...v2.0.0) (2026-03-02)

### ⚠ BREAKING CHANGES

- This module now requires node.js >=20.19.1 <22 _or_ >=22.12
- This module now only exports an ESM variant, CommonJS is no longer supported

### Features

- require node.js >= 20.10.1 or >=22.12, drop commonjs ([#3](https://github.com/sanity-io/worker-channels/issues/3)) ([d160579](https://github.com/sanity-io/worker-channels/commit/d160579d71b3db3c46e6f08ab53b958f6effb55c))

### Bug Fixes

- eliminiate leaks, possible race condition ([#2](https://github.com/sanity-io/worker-channels/issues/2)) ([1fa65cd](https://github.com/sanity-io/worker-channels/commit/1fa65cd910cda97d1b687326a733f72b8dc30c42))

## [1.1.0](https://github.com/sanity-io/worker-channels/compare/v1.0.0...v1.1.0) (2025-08-07)

### Features

- add commonjs/require build ([74f2f77](https://github.com/sanity-io/worker-channels/commit/74f2f77807121daee0876ec220a7008cddd9a01d))

### Bug Fixes

- prevent hang when stream ends before buffering ([e0b43f3](https://github.com/sanity-io/worker-channels/commit/e0b43f380f0bdde64e9434d08087abfc6282ad2f))

## 1.0.0 (2025-08-06)

### Bug Fixes

- conditionally consider CustomEvent ([9004944](https://github.com/sanity-io/worker-channels/commit/90049445679263f991d747eec0b5c64fbe786ce3))
- remove `Array.fromAsync` for compat ([9e5a825](https://github.com/sanity-io/worker-channels/commit/9e5a825f056bed1c2292a297f9415856e828b755))
- replace `Promise.withResolvers` ([658421c](https://github.com/sanity-io/worker-channels/commit/658421c847d59c1c36b73699792a790ba371c25b))
- switch to EventEmitter for node 18 ([d449816](https://github.com/sanity-io/worker-channels/commit/d44981608be7796292bf1ecb5d722b9e2af8af48))
