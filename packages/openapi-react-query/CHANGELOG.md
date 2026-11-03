# Changelog

## [3.12.3](https://github.com/codewithagents/openapi-zod-ts/compare/openapi-react-query-v3.12.2...openapi-react-query-v3.12.3) (2026-11-03)


### Bug Fixes

* **deps:** update all dependencies to latest ([#444](https://github.com/codewithagents/openapi-zod-ts/issues/444)) ([38de74e](https://github.com/codewithagents/openapi-zod-ts/commit/38de74ebf2836542b2fbe04f0d99f7b236d8fdf7))

## [3.12.2](https://github.com/codewithagents/openapi-zod-ts/compare/openapi-react-query-v3.12.1...openapi-react-query-v3.12.2) (2026-06-21)


### Performance Improvements

* **ci:** carve the 128-spec compat matrix off the required gate, parallelize coverage ([#352](https://github.com/codewithagents/openapi-zod-ts/issues/352)) ([939ea00](https://github.com/codewithagents/openapi-zod-ts/commit/939ea0025e190c42e45c05f3c298d68adc014a60))

## [3.12.1](https://github.com/codewithagents/openapi-zod-ts/compare/openapi-react-query-v3.12.0...openapi-react-query-v3.12.1) (2026-06-15)


### Bug Fixes

* **generator:** codegen typing fixes for [#298](https://github.com/codewithagents/openapi-zod-ts/issues/298), [#299](https://github.com/codewithagents/openapi-zod-ts/issues/299), [#300](https://github.com/codewithagents/openapi-zod-ts/issues/300) ([#301](https://github.com/codewithagents/openapi-zod-ts/issues/301)) ([42d2f66](https://github.com/codewithagents/openapi-zod-ts/commit/42d2f66336de796dff65454c3875dfd9164c4692))

## [3.12.0](https://github.com/codewithagents/openapi-zod-ts/compare/openapi-react-query-v3.11.0...openapi-react-query-v3.12.0) (2026-06-10)


### Features

* **config:** multi-spec projects array drives N generations from one file ([#238](https://github.com/codewithagents/openapi-zod-ts/issues/238)) ([#288](https://github.com/codewithagents/openapi-zod-ts/issues/288)) ([aab136b](https://github.com/codewithagents/openapi-zod-ts/commit/aab136b6e20972dd51528f55b7ec5aecfc57b34f))

## [3.11.0](https://github.com/codewithagents/openapi-zod-ts/compare/openapi-react-query-v3.10.1...openapi-react-query-v3.11.0) (2026-06-05)


### Features

* **openapi-react-query:** generate useInfiniteQuery hooks for paginated endpoints ([#189](https://github.com/codewithagents/openapi-zod-ts/issues/189)) ([#281](https://github.com/codewithagents/openapi-zod-ts/issues/281)) ([7d7aa2d](https://github.com/codewithagents/openapi-zod-ts/commit/7d7aa2de479616c76a76786ff02db62a65c7a784))

## [3.10.1](https://github.com/codewithagents/openapi-zod-ts/compare/openapi-react-query-v3.10.0...openapi-react-query-v3.10.1) (2026-06-03)


### Bug Fixes

* **react-query:** correct key-factory singularization for -ies/-sses, fixes [#273](https://github.com/codewithagents/openapi-zod-ts/issues/273) ([888718a](https://github.com/codewithagents/openapi-zod-ts/commit/888718abe600803675964e8c7e3782f95811a7fb))

## [3.10.0](https://github.com/codewithagents/openapi-zod-ts/compare/openapi-react-query-v3.9.1...openapi-react-query-v3.10.0) (2026-06-03)


### Miscellaneous

* Dependency renamed from `@codewithagents/openapi-gen` to `openapi-zod-ts` (`^1.0.0`). No public API changes. ([#266](https://github.com/codewithagents/openapi-zod-ts/issues/266))

## [3.9.1](https://github.com/codewithagents/openapi-zod-ts/compare/openapi-react-query-v3.9.0...openapi-react-query-v3.9.1) (2026-06-02)


### Bug Fixes

* **openapi-react-query:** emit and thread params arg when client requires it ([#259](https://github.com/codewithagents/openapi-zod-ts/issues/259)) ([#260](https://github.com/codewithagents/openapi-zod-ts/issues/260)) ([0619b7f](https://github.com/codewithagents/openapi-zod-ts/commit/0619b7f7b7a4a2f125355009fa45ff15b3434726))
* **openapi-react-query:** mirror client operationId uniquification in hooks ([#254](https://github.com/codewithagents/openapi-zod-ts/issues/254)) ([#257](https://github.com/codewithagents/openapi-zod-ts/issues/257)) ([d128037](https://github.com/codewithagents/openapi-zod-ts/commit/d128037dfd0d1e08498e9981afbd86e162222d40))

## [3.9.0](https://github.com/codewithagents/openapi-zod-ts/compare/openapi-react-query-v3.8.0...openapi-react-query-v3.9.0) (2026-06-02)


### Features

* **cli:** shared cli-core eliminates byte-identical parseCliArgs across packages ([#238](https://github.com/codewithagents/openapi-zod-ts/issues/238)) ([#252](https://github.com/codewithagents/openapi-zod-ts/issues/252)) ([200af1f](https://github.com/codewithagents/openapi-zod-ts/commit/200af1fcb94bb570bc18d79eedfdd3e0125c8d85))


### Bug Fixes

* **openapi-gen,react-query:** share operation-name derivation so client and hooks agree ([#241](https://github.com/codewithagents/openapi-zod-ts/issues/241)) ([#255](https://github.com/codewithagents/openapi-zod-ts/issues/255)) ([5680f19](https://github.com/codewithagents/openapi-zod-ts/commit/5680f19ac445f95954236e5553a96e9882d3f77c))
* **openapi-react-query:** type mutation variables as the writable variant; single writableVariantMap ([#242](https://github.com/codewithagents/openapi-zod-ts/issues/242), [#243](https://github.com/codewithagents/openapi-zod-ts/issues/243)) ([#256](https://github.com/codewithagents/openapi-zod-ts/issues/256)) ([ecf7c36](https://github.com/codewithagents/openapi-zod-ts/commit/ecf7c36b83c7330e1406fa866b0eb528c09879e5))

## [3.8.0](https://github.com/codewithagents/openapi-zod-ts/compare/openapi-react-query-v3.7.0...openapi-react-query-v3.8.0) (2026-06-01)


### Features

* **config:** shared config-core + JS config support for react-query/server ([#238](https://github.com/codewithagents/openapi-zod-ts/issues/238)) ([#239](https://github.com/codewithagents/openapi-zod-ts/issues/239)) ([b4559a9](https://github.com/codewithagents/openapi-zod-ts/commit/b4559a96bef3396dbd24ddfec0e2799ee93c7d9d))

## [3.7.0](https://github.com/codewithagents/openapi-zod-ts/compare/openapi-react-query-v3.6.1...openapi-react-query-v3.7.0) (2026-06-01)


### Features

* **openapi-react-query:** queryOptions() factories + SSR prefetch/hydration ([#188](https://github.com/codewithagents/openapi-zod-ts/issues/188)) ([#233](https://github.com/codewithagents/openapi-zod-ts/issues/233)) ([04dd665](https://github.com/codewithagents/openapi-zod-ts/commit/04dd6650dac8f05f65b371585381458b1a88d44a))

## [3.6.1](https://github.com/codewithagents/openapi-zod-ts/compare/openapi-react-query-v3.6.0...openapi-react-query-v3.6.1) (2026-06-01)


### Bug Fixes

* **openapi-gen:** de-duplicate colliding generated function names ([#182](https://github.com/codewithagents/openapi-zod-ts/issues/182)) ([#206](https://github.com/codewithagents/openapi-zod-ts/issues/206)) ([858d53c](https://github.com/codewithagents/openapi-zod-ts/commit/858d53c4b07d245d81c0e8c282149ac60987c8bf))

## [3.6.0](https://github.com/codewithagents/openapi-zod-ts/compare/openapi-react-query-v3.5.2...openapi-react-query-v3.6.0) (2026-06-01)


### Features

* **cli:** add --help and --version to all three CLIs ([#178](https://github.com/codewithagents/openapi-zod-ts/issues/178)) ([#203](https://github.com/codewithagents/openapi-zod-ts/issues/203)) ([6f641e0](https://github.com/codewithagents/openapi-zod-ts/commit/6f641e05d3d19c1a4394247c3c079556e8a52274))


### Bug Fixes

* **openapi-react-query:** add public API barrel so dist/index.js is built ([#174](https://github.com/codewithagents/openapi-zod-ts/issues/174)) ([#198](https://github.com/codewithagents/openapi-zod-ts/issues/198)) ([18f7eb0](https://github.com/codewithagents/openapi-zod-ts/commit/18f7eb056880958f74110e0e6df114b68633a5d1))

## [3.5.2](https://github.com/codewithagents/openapi-zod-ts/compare/openapi-react-query-v3.5.1...openapi-react-query-v3.5.2) (2026-05-31)


### Bug Fixes

* **security:** escape spec-derived strings in generated code ([#169](https://github.com/codewithagents/openapi-zod-ts/issues/169)) ([35f232d](https://github.com/codewithagents/openapi-zod-ts/commit/35f232dbb6b4baaea652a87f44bbd9f4e2f3046c))

## [3.5.1](https://github.com/codewithagents/openapi-zod-ts/compare/openapi-react-query-v3.5.0...openapi-react-query-v3.5.1) (2026-05-31)


### Bug Fixes

* add consistent package metadata (homepage, bugs, author) across all packages ([#166](https://github.com/codewithagents/openapi-zod-ts/issues/166)) ([dc2c1d3](https://github.com/codewithagents/openapi-zod-ts/commit/dc2c1d327e87dabbe07450a1664ba6158aff82de))

## [3.5.0](https://github.com/codewithagents/openapi-ts/compare/openapi-react-query-v3.4.0...openapi-react-query-v3.5.0) (2026-05-30)


### Features

* **openapi-server:** add Express and Fastify router generation with Zod validation ([a1a9d53](https://github.com/codewithagents/openapi-ts/commit/a1a9d5390ae8584afee183835d0976bae4239d28))

## [3.4.0](https://github.com/codewithagents/glue/compare/openapi-react-query-v3.3.1...openapi-react-query-v3.4.0) (2026-05-29)


### Features

* **smoke:** expand to 9 real API requests, run on every push to main ([#144](https://github.com/codewithagents/glue/issues/144)) ([ba0c7c3](https://github.com/codewithagents/glue/commit/ba0c7c39c97f4f0a152fed67676346c035de90fd))

## [3.3.1](https://github.com/codewithagents/glue/compare/openapi-react-query-v3.3.0...openapi-react-query-v3.3.1) (2026-05-29)


### Bug Fixes

* **ci:** isolate codecov uploads + expand compat matrix to all 3 generators ([#140](https://github.com/codewithagents/glue/issues/140)) ([240b79a](https://github.com/codewithagents/glue/commit/240b79a0360d2f89cc08db56e8629c8c068c07a2))
* **coverage:** use lcov projectRoot option to emit repo-relative SF paths ([8cefc4f](https://github.com/codewithagents/glue/commit/8cefc4fa39755c923b97c0938ccec72b3fe3768f))

## [3.3.0](https://github.com/codewithagents/glue/compare/openapi-react-query-v3.2.0...openapi-react-query-v3.3.0) (2026-05-27)


### Features

* format generated output with Prettier; ESLint validation in integration ([#131](https://github.com/codewithagents/glue/issues/131)) ([c1db744](https://github.com/codewithagents/glue/commit/c1db744c677655d541a943122f16e00dab6373e3))

## [3.2.0](https://github.com/codewithagents/glue/compare/openapi-react-query-v3.1.3...openapi-react-query-v3.2.0) (2026-05-27)


### Features

* **openapi-react-query:** always generate test-utils.ts with zero new dependencies ([#127](https://github.com/codewithagents/glue/issues/127)) ([8fccceb](https://github.com/codewithagents/glue/commit/8fccceb74e6f8f2fd13202abbe27df7816a95118)), closes [#123](https://github.com/codewithagents/glue/issues/123)

## [3.1.3](https://github.com/codewithagents/glue/compare/openapi-react-query-v3.1.2...openapi-react-query-v3.1.3) (2026-05-27)


### Bug Fixes

* **openapi-react-query:** document key collision and onSuccess ordering decisions ([#121](https://github.com/codewithagents/glue/issues/121)) ([0336b7a](https://github.com/codewithagents/glue/commit/0336b7a84af79d9e893a94d14f7402dc6f36eb85))

## [3.1.2](https://github.com/codewithagents/glue/compare/openapi-react-query-v3.1.1...openapi-react-query-v3.1.2) (2026-05-26)


### Bug Fixes

* **openapi-react-query:** key collision on multiple detail ops; options spread before onSuccess ([#115](https://github.com/codewithagents/glue/issues/115)) ([3181e15](https://github.com/codewithagents/glue/commit/3181e15ead7eb852de426182dadb9e9c95cd4919))

## [3.1.1](https://github.com/codewithagents/glue/compare/openapi-react-query-v3.1.0...openapi-react-query-v3.1.1) (2026-05-25)


### Bug Fixes

* **openapi-react-query:** skip auto-invalidation for mutation-only resources ([#86](https://github.com/codewithagents/glue/issues/86)) ([f8366e5](https://github.com/codewithagents/glue/commit/f8366e5c77b2fe3367bccdedb0651da457532e4a))

## [3.1.0](https://github.com/codewithagents/glue/compare/openapi-react-query-v3.0.0...openapi-react-query-v3.1.0) (2026-05-25)


### Features

* **integration:** consumer type simulation + CI path validation tests ([#77](https://github.com/codewithagents/glue/issues/77)) ([8a4a2b4](https://github.com/codewithagents/glue/commit/8a4a2b40987fcd25fdf5fe5d5f5a6f84fd9b95df))


### Bug Fixes

* **openapi-react-query:** auto-invalidation uses correct key name when multiple detail ops exist ([#78](https://github.com/codewithagents/glue/issues/78)) ([0f85328](https://github.com/codewithagents/glue/commit/0f85328a92e05c461b1fce7c91bcc2ed1443663a))

## [3.0.0](https://github.com/codewithagents/glue/compare/openapi-react-query-v2.0.1...openapi-react-query-v3.0.0) (2026-05-25)


### ⚠ BREAKING CHANGES

* major version bump from 0.x — update your version range from ^0.x to ^1.0.0.

### Features

* add @codewithagents/openapi-react-query — generate typed React Query v5 hooks from OpenAPI specs ([#37](https://github.com/codewithagents/glue/issues/37)) ([fe558a7](https://github.com/codewithagents/glue/commit/fe558a741c78931d7a36dd9d91eacedcce30bbef))
* **cli:** add --config flag to openapi-gen and openapi-react-query with path security validation ([#38](https://github.com/codewithagents/glue/issues/38)) ([56c4352](https://github.com/codewithagents/glue/commit/56c435213dd59fd856e11102a22c12eb0d7aa0e4))
* **openapi-gen:** deprecated JSDoc, numeric enums, date-time format, typed error unions, discriminated unions ([b23bd69](https://github.com/codewithagents/glue/commit/b23bd69000ea9ca24a9188863ecb5a6ad5b18fc8))
* promote api-errors and openapi-react-query to stable 1.0.0 ([#47](https://github.com/codewithagents/glue/issues/47)) ([075be06](https://github.com/codewithagents/glue/commit/075be063b4588080f94dc7f228ca8f30ea8aa5e8))
* React Query enhancements — nullish params, suspense, auto-invalidate, per-resource cache, server client ([#67](https://github.com/codewithagents/glue/issues/67)) ([6a407ea](https://github.com/codewithagents/glue/commit/6a407eab12c66d0d4baba571e11538bcfa898e1a))


### Bug Fixes

* CI path false positive, onSuccess spread, explicit server client signatures ([#72](https://github.com/codewithagents/glue/issues/72)) ([ec25bb0](https://github.com/codewithagents/glue/commit/ec25bb0c0f5df8a20c2b31a1aa499408a0ed3fcc))
* CI path false positive, onSuccess spread, explicit server client signatures ([#73](https://github.com/codewithagents/glue/issues/73)) ([f21d93d](https://github.com/codewithagents/glue/commit/f21d93d63e57ed97380820788a3ed9ad75e4adc9))
* **openapi-react-query:** camelCase key factory names from kebab/snake path segments ([#46](https://github.com/codewithagents/glue/issues/46)) ([9b3c072](https://github.com/codewithagents/glue/commit/9b3c072efc37e765cc12547e87b6043bb75c0e89))
* **openapi-react-query:** params optionality, key factory args, mutation shapes ([#52](https://github.com/codewithagents/glue/issues/52) [#53](https://github.com/codewithagents/glue/issues/53) [#54](https://github.com/codewithagents/glue/issues/54)) ([c3e0be0](https://github.com/codewithagents/glue/commit/c3e0be0d28e72055221a589f0fbc92e41438f297))
* **openapi-react-query:** resolve workspace:* on publish via pnpm pack, bump to 1.0.1 ([0c02b85](https://github.com/codewithagents/glue/commit/0c02b8592de9abb68ef01e5f470702b6bbe69c0e))

## [2.0.1](https://github.com/codewithagents/glue/compare/openapi-react-query-v2.0.0...openapi-react-query-v2.0.1) (2026-05-25)


### Bug Fixes

* CI path false positive, onSuccess spread, explicit server client signatures ([#72](https://github.com/codewithagents/glue/issues/72)) ([ec25bb0](https://github.com/codewithagents/glue/commit/ec25bb0c0f5df8a20c2b31a1aa499408a0ed3fcc))

## [2.0.0](https://github.com/codewithagents/glue/compare/openapi-react-query-v1.0.3...openapi-react-query-v2.0.0) (2026-05-25)


### ⚠ BREAKING CHANGES

* major version bump from 0.x — update your version range from ^0.x to ^1.0.0.

### Features

* add @codewithagents/openapi-react-query — generate typed React Query v5 hooks from OpenAPI specs ([#37](https://github.com/codewithagents/glue/issues/37)) ([fe558a7](https://github.com/codewithagents/glue/commit/fe558a741c78931d7a36dd9d91eacedcce30bbef))
* **cli:** add --config flag to openapi-gen and openapi-react-query with path security validation ([#38](https://github.com/codewithagents/glue/issues/38)) ([56c4352](https://github.com/codewithagents/glue/commit/56c435213dd59fd856e11102a22c12eb0d7aa0e4))
* **openapi-gen:** deprecated JSDoc, numeric enums, date-time format, typed error unions, discriminated unions ([b23bd69](https://github.com/codewithagents/glue/commit/b23bd69000ea9ca24a9188863ecb5a6ad5b18fc8))
* promote api-errors and openapi-react-query to stable 1.0.0 ([#47](https://github.com/codewithagents/glue/issues/47)) ([075be06](https://github.com/codewithagents/glue/commit/075be063b4588080f94dc7f228ca8f30ea8aa5e8))


### Bug Fixes

* **openapi-react-query:** camelCase key factory names from kebab/snake path segments ([#46](https://github.com/codewithagents/glue/issues/46)) ([9b3c072](https://github.com/codewithagents/glue/commit/9b3c072efc37e765cc12547e87b6043bb75c0e89))
* **openapi-react-query:** params optionality, key factory args, mutation shapes ([#52](https://github.com/codewithagents/glue/issues/52) [#53](https://github.com/codewithagents/glue/issues/53) [#54](https://github.com/codewithagents/glue/issues/54)) ([c3e0be0](https://github.com/codewithagents/glue/commit/c3e0be0d28e72055221a589f0fbc92e41438f297))
* **openapi-react-query:** resolve workspace:* on publish via pnpm pack, bump to 1.0.1 ([0c02b85](https://github.com/codewithagents/glue/commit/0c02b8592de9abb68ef01e5f470702b6bbe69c0e))

## [1.0.0](https://github.com/codewithagents/glue/compare/openapi-react-query-v0.2.0...openapi-react-query-v1.0.0) (2026-05-24)


### ⚠ BREAKING CHANGES

* major version bump from 0.x — update your version range from ^0.x to ^1.0.0.

### Features

* promote api-errors and openapi-react-query to stable 1.0.0 ([#47](https://github.com/codewithagents/glue/issues/47)) ([075be06](https://github.com/codewithagents/glue/commit/075be063b4588080f94dc7f228ca8f30ea8aa5e8))

## [0.2.0](https://github.com/codewithagents/glue/compare/openapi-react-query-v0.1.0...openapi-react-query-v0.2.0) (2026-05-24)


### Features

* add @codewithagents/openapi-react-query — generate typed React Query v5 hooks from OpenAPI specs ([#37](https://github.com/codewithagents/glue/issues/37)) ([fe558a7](https://github.com/codewithagents/glue/commit/fe558a741c78931d7a36dd9d91eacedcce30bbef))
* **cli:** add --config flag to openapi-gen and openapi-react-query with path security validation ([#38](https://github.com/codewithagents/glue/issues/38)) ([56c4352](https://github.com/codewithagents/glue/commit/56c435213dd59fd856e11102a22c12eb0d7aa0e4))


### Bug Fixes

* **openapi-react-query:** camelCase key factory names from kebab/snake path segments ([#46](https://github.com/codewithagents/glue/issues/46)) ([9b3c072](https://github.com/codewithagents/glue/commit/9b3c072efc37e765cc12547e87b6043bb75c0e89))

## 0.1.0 (2026-05-24)


### Features

* **openapi-react-query:** initial release — typed React Query v5 hooks from OpenAPI 3.1 specs ([#37](https://github.com/codewithagents/glue/issues/37)) ([56c4352](https://github.com/codewithagents/glue/commit/56c4352))
* **openapi-react-query:** add --config flag with path security validation ([#38](https://github.com/codewithagents/glue/issues/38))
