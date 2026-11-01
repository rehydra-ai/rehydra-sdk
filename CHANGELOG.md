# Changelog

## [0.16.3](https://github.com/rehydra-ai/rehydra-sdk/compare/v0.16.2...v0.16.3) (2026-11-01)


### Bug Fixes

* apply policy.customIdPatterns and gate custom IDs by their own type ([8b84434](https://github.com/rehydra-ai/rehydra-sdk/commit/8b84434c56f36ab56208397ea60c93bb2c29bfa7))
* apply policy.customIdPatterns and gate custom IDs by their own type ([775d6de](https://github.com/rehydra-ai/rehydra-sdk/commit/775d6decd3b76b4d1c50ecf7a267359fc0963fdb)), closes [#117](https://github.com/rehydra-ai/rehydra-sdk/issues/117)

## [0.16.2](https://github.com/rehydra-ai/rehydra-sdk/compare/v0.16.1...v0.16.2) (2026-11-01)


### Bug Fixes

* **opencode:** leave binary payloads untouched when scrubbing tool results ([ee7de13](https://github.com/rehydra-ai/rehydra-sdk/commit/ee7de13130b34e9dc81bd8d0b32e9a4862de6683))
* **opencode:** only skip data URIs whose payload is base64 throughout ([5536662](https://github.com/rehydra-ai/rehydra-sdk/commit/5536662328d244d56c61e7cf2798a7d591a61a13))

## [0.16.1](https://github.com/rehydra-ai/rehydra-sdk/compare/v0.16.0...v0.16.1) (2026-11-01)


### Bug Fixes

* **opencode:** assign copies of frozen tool input on OpenCode 2 ([c0f16db](https://github.com/rehydra-ai/rehydra-sdk/commit/c0f16dbcd3a4a31f45630c3168f57920a641e4ad))
* **opencode:** assign copies of frozen tool input on OpenCode 2 ([64dd320](https://github.com/rehydra-ai/rehydra-sdk/commit/64dd3207310311b9afa0c18bc049326107f49703)), closes [#121](https://github.com/rehydra-ai/rehydra-sdk/issues/121)
* **opencode:** keep image generation prompts redacted by default ([54aedfa](https://github.com/rehydra-ai/rehydra-sdk/commit/54aedfa87ed1ad239217893c091e4665e1f25b18))
* **opencode:** keep image generation prompts redacted by default ([b7f3dfc](https://github.com/rehydra-ai/rehydra-sdk/commit/b7f3dfc54d9c321c21b1ec50cd841b356365ced5))
* **proxy:** anonymize tool-call arguments in request history ([9860805](https://github.com/rehydra-ai/rehydra-sdk/commit/98608055fe1edc3698ae5bca748e329da9d555dd))
* **proxy:** anonymize tool-call arguments in request history ([bc70f03](https://github.com/rehydra-ai/rehydra-sdk/commit/bc70f03599a3b94fe05a099a333e7fc9204d6e77))

## [0.16.0](https://github.com/rehydra-ai/rehydra-sdk/compare/v0.15.0...v0.16.0) (2026-10-16)


### Features

* **opencode:** keep webfetch and websearch args redacted by default ([2fd41b0](https://github.com/rehydra-ai/rehydra-sdk/commit/2fd41b038840981c9bdd754ba88c5c2d6dc921c4))
* **opencode:** reload env files and keep tool args redacted ([5bbfcb4](https://github.com/rehydra-ai/rehydra-sdk/commit/5bbfcb45ff55e382a75b0d67dd702db8de4c6d06))
* **opencode:** reload env files and keep tool args redacted ([d1a6b13](https://github.com/rehydra-ai/rehydra-sdk/commit/d1a6b13649d25fc0c886aaf0b73fb32df1667b40)), closes [#107](https://github.com/rehydra-ai/rehydra-sdk/issues/107) [#108](https://github.com/rehydra-ai/rehydra-sdk/issues/108)

## [0.15.0](https://github.com/rehydra-ai/rehydra-sdk/compare/v0.14.0...v0.15.0) (2026-10-16)


### Features

* **opencode:** support OpenCode 2 V2 plugin API via dual V1/V2 entrypoint ([04a5c2f](https://github.com/rehydra-ai/rehydra-sdk/commit/04a5c2f69ca3677e18c4c59f52a7a6acda1b9a8f))
* **opencode:** support OpenCode 2 V2 plugin API via dual V1/V2 entrypoint ([47a8154](https://github.com/rehydra-ai/rehydra-sdk/commit/47a81541c5f0c30500a9ccc80dfb334fb53f0730))
* **plugin:** dual V1/V2 entrypoint — add OpenCode 2 (V2 Plugin API) support ([38c4a94](https://github.com/rehydra-ai/rehydra-sdk/commit/38c4a946602cd13942a06589bde2aeb4790ecc90))


### Bug Fixes

* **opencode:** apply plugin options from opencode.json ([adc572f](https://github.com/rehydra-ai/rehydra-sdk/commit/adc572fc3766104ac00cae9a0ce0ec7a44664b60))
* **opencode:** apply plugin options from opencode.json ([7e7dd50](https://github.com/rehydra-ai/rehydra-sdk/commit/7e7dd506b4211a267983cab8981e68c0bcb794c0))
* **recognizers:** match full multi-segment case IDs ([b7f6f65](https://github.com/rehydra-ai/rehydra-sdk/commit/b7f6f6520f6f579aa8ddea655a13dca3cf6c7731))
* **recognizers:** match full multi-segment case IDs ([d3c1b50](https://github.com/rehydra-ai/rehydra-sdk/commit/d3c1b50b793933e4afb23a3b09e14e92617d47de))

## [0.14.0](https://github.com/rehydra-ai/rehydra-sdk/compare/v0.13.0...v0.14.0) (2026-09-06)


### Features

* detect UK postcodes and numbered street addresses ([28d3d47](https://github.com/rehydra-ai/rehydra-sdk/commit/28d3d474815f0a55af0bcf43470fd9019c0df058))
* detect UK postcodes and numbered street addresses ([6578216](https://github.com/rehydra-ai/rehydra-sdk/commit/6578216e5185cd73178766dd9fb49a3b572431d8))
* **opencode:** redact Git author identities ([c79fb7a](https://github.com/rehydra-ai/rehydra-sdk/commit/c79fb7acf388ddc116bbdf249f099574b2b0ed61))
* **opencode:** redact GitHub participant identities ([30d758f](https://github.com/rehydra-ai/rehydra-sdk/commit/30d758f853151121f062def9949215359e0438a1))
* **opencode:** redact VCS identities ([eb5a41c](https://github.com/rehydra-ai/rehydra-sdk/commit/eb5a41c50352d84a0576b27c76d011cdca91a9b1))
* **proxy:** execute streaming tool loops with bounded buffering ([f5c8be9](https://github.com/rehydra-ai/rehydra-sdk/commit/f5c8be94979b74440acf01a9e5c4174a83207dcc))
* **proxy:** support streaming server-side tool loops ([f6525b2](https://github.com/rehydra-ai/rehydra-sdk/commit/f6525b291b7484d1e35715095898f8d1827ef0b5))
* support alphanumeric tag IDs ([#93](https://github.com/rehydra-ai/rehydra-sdk/issues/93)) ([8bf2108](https://github.com/rehydra-ai/rehydra-sdk/commit/8bf2108a7f7091dcb62378e2208dd2286ef85ed0))


### Bug Fixes

* **opencode:** constrain VCS identity detection and preserve policies ([5afe857](https://github.com/rehydra-ai/rehydra-sdk/commit/5afe857ce420d9004a4f818865b2352b7375e52f))
* **opencode:** discover project env files by default ([37b9128](https://github.com/rehydra-ai/rehydra-sdk/commit/37b912850bd50a51b78b21dcf22ac875bc015796))
* **opencode:** load and discover project env files by default ([141d635](https://github.com/rehydra-ai/rehydra-sdk/commit/141d635b8f6ed6b44c6f8128c7b7f23599351760))
* **opencode:** preserve existing identity tags on repeated transforms ([544acd3](https://github.com/rehydra-ai/rehydra-sdk/commit/544acd389d59a32d31d8fe81a18e65244ad1cfff))
* **opencode:** redact restored tool arguments in model history ([09f1b8f](https://github.com/rehydra-ai/rehydra-sdk/commit/09f1b8fa83c9d0f2155a50b1c0abc19cefeb19fc))
* **opencode:** redact restored tool arguments in model history ([2434bfb](https://github.com/rehydra-ai/rehydra-sdk/commit/2434bfb5d535ccebefc39d3a2df1104433080353))
* **proxy:** emit Anthropic thinking and signature deltas ([e64efbc](https://github.com/rehydra-ai/rehydra-sdk/commit/e64efbcb9d1a2db266a4f629698f2825a638d23a))
* retain GitHub identity overlap priority ([c1f2475](https://github.com/rehydra-ai/rehydra-sdk/commit/c1f2475415371ecc4c1c6ccbdeae52e84a60ad7c))

## [0.13.0](https://github.com/rehydra-ai/rehydra-sdk/compare/v0.12.0...v0.13.0) (2026-08-09)


### Features

* **proxy:** warn on duplicated path segment when upstream includes a base path ([#90](https://github.com/rehydra-ai/rehydra-sdk/issues/90)) ([6ccc372](https://github.com/rehydra-ai/rehydra-sdk/commit/6ccc372ba0b0c556f4fa8dc04d192baf63259bf8)), closes [#77](https://github.com/rehydra-ai/rehydra-sdk/issues/77)

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
