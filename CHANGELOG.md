# Changelog

## [0.24.0](https://github.com/tomek-i/narrate-plugin/compare/v0.23.0...v0.24.0) (2026-11-12)


### ⚠ Behaviour changes

* **render:** a scene with two beats that share an `id` is now rejected before anything is recorded. Such scenes used to render with wrong timing and captions, because audio and timing are keyed by beat id. Run `narrate validate <scene.json>` to find duplicates (it also reports keys the scene schema doesn't know). ([#44](https://github.com/tomek-i/narrate-plugin/issues/44))

### Features

* **cli:** narrate validate checks a scene without rendering ([#44](https://github.com/tomek-i/narrate-plugin/issues/44)) ([33b4216](https://github.com/tomek-i/narrate-plugin/commit/33b421696fa85558c9ebbda3304e16de02812f01))
* **cli:** stable launchers in ~/.narrate/bin that follow plugin updates ([#46](https://github.com/tomek-i/narrate-plugin/issues/46)) ([18c990d](https://github.com/tomek-i/narrate-plugin/commit/18c990d28ffdb8fbe23e479316676e956fd42f23))
* **record:** configurable page-load wait for apps that never go idle ([#41](https://github.com/tomek-i/narrate-plugin/issues/41)) ([1a005cf](https://github.com/tomek-i/narrate-plugin/commit/1a005cf0fc8bf8d7efed191ddafa6c9dc1aa17b5))
* **record:** opt-in same-origin guard for recorded scenes ([#42](https://github.com/tomek-i/narrate-plugin/issues/42)) ([747d8ad](https://github.com/tomek-i/narrate-plugin/commit/747d8ade9860f99df5d38109180bf3799235139d))
* **render:** --json result and --log file for agents ([#45](https://github.com/tomek-i/narrate-plugin/issues/45)) ([72f8d31](https://github.com/tomek-i/narrate-plugin/commit/72f8d31a15f7e7640f94c836bc69d42f456e3d6b))
* **render:** stop the browser and ffmpeg when interrupted ([#47](https://github.com/tomek-i/narrate-plugin/issues/47)) ([cf4a70a](https://github.com/tomek-i/narrate-plugin/commit/cf4a70a6fe695e9a4b72fe8d173249c763fbf181))
* **render:** untrusted mode and --no-env for generated scenes ([#43](https://github.com/tomek-i/narrate-plugin/issues/43)) ([cb5baf4](https://github.com/tomek-i/narrate-plugin/commit/cb5baf4c92f6b65582df18da1ee87b50bebf0833))
* **tts:** voice tags, and a refresh of the skills ([#48](https://github.com/tomek-i/narrate-plugin/issues/48)) ([335daab](https://github.com/tomek-i/narrate-plugin/commit/335daab7fdde8c50fe9297607df1d0e6e4ce7117))


### Bug Fixes

* **config:** name every place checked when a tts key is missing ([#39](https://github.com/tomek-i/narrate-plugin/issues/39)) ([b9f2f06](https://github.com/tomek-i/narrate-plugin/commit/b9f2f0656541682af2bab611ce5e7260d2a2df61))
* **tts:** remove the OS voice's scratch folder when synthesis fails ([#49](https://github.com/tomek-i/narrate-plugin/issues/49)) ([60f49a5](https://github.com/tomek-i/narrate-plugin/commit/60f49a57794d50c79c2931978d8a298190370d21))

## [0.23.0](https://github.com/tomek-i/narrate-plugin/compare/v0.22.0...v0.23.0) (2026-11-04)


### Features

* set API keys without exposing them on the command line ([#24](https://github.com/tomek-i/narrate-plugin/issues/24)) ([c547d3d](https://github.com/tomek-i/narrate-plugin/commit/c547d3dff6ce74c66225a5739648cc65e28b8109))

## [0.22.0](https://github.com/tomek-i/narrate-plugin/compare/v0.21.0...v0.22.0) (2026-10-21)


### Features

* global user settings with per-project overrides ([#20](https://github.com/tomek-i/narrate-plugin/issues/20)) ([25b6992](https://github.com/tomek-i/narrate-plugin/commit/25b6992ed2b02800e48d2e49d3c0f06ecf57dd61))
