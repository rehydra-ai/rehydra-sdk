# Changelog

## [0.12.0](https://github.com/rehydra-ai/rehydra-sdk/compare/v0.11.1...v0.12.0) (2026-07-25)


### Features

* **ner:** cap windows and bound tokenization on long inputs ([#87](https://github.com/rehydra-ai/rehydra-sdk/issues/87)) ([a70ac74](https://github.com/rehydra-ai/rehydra-sdk/commit/a70ac748aa05962597e7ad6ebbb53eb7b07ed7a2))

## [0.11.1](https://github.com/rehydra-ai/rehydra-sdk/compare/v0.11.0...v0.11.1) (2026-07-21)


### Bug Fixes

* fall back to registry label map instead of mismatched default ([#86](https://github.com/rehydra-ai/rehydra-sdk/issues/86)) ([3edb6b0](https://github.com/rehydra-ai/rehydra-sdk/commit/3edb6b0842c3efdc9d19f23e2da3788d659ea034)), closes [#85](https://github.com/rehydra-ai/rehydra-sdk/issues/85)
* process long inputs in overlapping NER windows instead of truncating ([#83](https://github.com/rehydra-ai/rehydra-sdk/issues/83)) ([d458f17](https://github.com/rehydra-ai/rehydra-sdk/commit/d458f1753a4d7fbb2eada2a33dbb0532855fd524))

## [0.11.0](https://github.com/rehydra-ai/rehydra-sdk/compare/v0.10.4...v0.11.0) (2026-06-07)


### Features

* **proxy:** log per-request anonymization with --verbose ([#78](https://github.com/rehydra-ai/rehydra-sdk/issues/78)) ([466be42](https://github.com/rehydra-ai/rehydra-sdk/commit/466be42389e826a7db4b24ac995e4380f4491cba)), closes [#76](https://github.com/rehydra-ai/rehydra-sdk/issues/76)

## [0.10.4](https://github.com/rehydra-ai/rehydra-sdk/compare/v0.10.3...v0.10.4) (2026-06-07)


### Bug Fixes

* guard PUBLISH_FLAGS expansion against unbound variable on empty array ([#75](https://github.com/rehydra-ai/rehydra-sdk/issues/75)) ([d34b6ba](https://github.com/rehydra-ai/rehydra-sdk/commit/d34b6ba5f08d0697907178a80f4f94513cee71dd))

## [0.10.3](https://github.com/rehydra-ai/rehydra-sdk/compare/v0.10.2...v0.10.3) (2026-06-01)


### Bug Fixes

* buffer partial PII tag prefixes split across SSE chunks ([#72](https://github.com/rehydra-ai/rehydra-sdk/issues/72)) ([9a48039](https://github.com/rehydra-ai/rehydra-sdk/commit/9a48039870e6fd323c9e35c0cddefed1383c5eec)), closes [#71](https://github.com/rehydra-ai/rehydra-sdk/issues/71)

## [0.10.2](https://github.com/rehydra-ai/rehydra-sdk/compare/v0.10.1...v0.10.2) (2026-04-07)


### Bug Fixes

* rehydrate custom-type tags from createCustomIdRecognizer ([#68](https://github.com/rehydra-ai/rehydra-sdk/issues/68)) ([#69](https://github.com/rehydra-ai/rehydra-sdk/issues/69)) ([f0727e3](https://github.com/rehydra-ai/rehydra-sdk/commit/f0727e33385dc9f94c0757eb8e04eb119eb4d33e))

## [0.10.1](https://github.com/rehydra-ai/rehydra-sdk/compare/v0.10.0...v0.10.1) (2026-04-04)


### Bug Fixes

* merge partial defaultPolicy with SDK defaults and add macro-region scope ([#66](https://github.com/rehydra-ai/rehydra-sdk/issues/66)) ([9d1118c](https://github.com/rehydra-ai/rehydra-sdk/commit/9d1118cb344fe136c51bca35f93acaae114547a4))

## [0.10.0](https://github.com/rehydra-ai/rehydra-sdk/compare/v0.9.1...v0.10.0) (2026-04-04)


### Features

* add excludeLocationScopes policy option ([#63](https://github.com/rehydra-ai/rehydra-sdk/issues/63)) ([fc06584](https://github.com/rehydra-ai/rehydra-sdk/commit/fc06584437d71bd27ab61a31d35a0339e5fffe21))
* add regex-based DATE recognizer for common date formats ([#62](https://github.com/rehydra-ai/rehydra-sdk/issues/62)) ([cb5be93](https://github.com/rehydra-ai/rehydra-sdk/commit/cb5be93c006b11239df3d32da166e69343ab80fd))

## [0.9.1](https://github.com/rehydra-ai/rehydra-sdk/compare/v0.9.0...v0.9.1) (2026-04-02)


### Bug Fixes

* handle MCP tool results in opencode plugin tool.execute.after hook ([#60](https://github.com/rehydra-ai/rehydra-sdk/issues/60)) ([b5bc9e0](https://github.com/rehydra-ai/rehydra-sdk/commit/b5bc9e0d1a034838e01e2edb4b7702e5a6ff904c)), closes [#59](https://github.com/rehydra-ai/rehydra-sdk/issues/59)

## [0.9.0](https://github.com/rehydra-ai/rehydra-sdk/compare/v0.8.0...v0.9.0) (2026-03-28)


### Features

* configurable PII tag format ([#57](https://github.com/rehydra-ai/rehydra-sdk/issues/57)) ([3849d67](https://github.com/rehydra-ai/rehydra-sdk/commit/3849d67363380900b7a3823381f0a044fa415e42))

## [0.8.0](https://github.com/rehydra-ai/rehydra-sdk/compare/v0.7.0...v0.8.0) (2026-03-27)


### Features

* add `rehydra proxy` CLI command for LLM API PII filtering ([#53](https://github.com/rehydra-ai/rehydra-sdk/issues/53)) ([4e2832d](https://github.com/rehydra-ai/rehydra-sdk/commit/4e2832d87d93af9313d7e3d310b1ba7f7b03a818))
