# Changelog

## [2.3.1](https://github.com/codewithagents/openapi-zod-ts/compare/openapi-zod-ts-v2.3.0...openapi-zod-ts-v2.3.1) (2026-11-03)


### Bug Fixes

* **deps:** update all dependencies to latest ([#444](https://github.com/codewithagents/openapi-zod-ts/issues/444)) ([38de74e](https://github.com/codewithagents/openapi-zod-ts/commit/38de74ebf2836542b2fbe04f0d99f7b236d8fdf7))

## [2.3.0](https://github.com/codewithagents/openapi-zod-ts/compare/openapi-zod-ts-v2.2.3...openapi-zod-ts-v2.3.0) (2026-07-04)


### Features

* **openapi-zod-ts:** add --check-drift CI gate for generated output ([#400](https://github.com/codewithagents/openapi-zod-ts/issues/400)) ([bb9f257](https://github.com/codewithagents/openapi-zod-ts/commit/bb9f25732c03e397cd549aed6cd33442ec7379e4))

## [2.2.3](https://github.com/codewithagents/openapi-zod-ts/compare/openapi-zod-ts-v2.2.2...openapi-zod-ts-v2.2.3) (2026-06-24)


### Bug Fixes

* **openapi-zod-ts:** assert recursive lazy schemas as z.ZodType&lt;T&gt; ([#398](https://github.com/codewithagents/openapi-zod-ts/issues/398)) ([0ca96f7](https://github.com/codewithagents/openapi-zod-ts/commit/0ca96f7de26294036b748e3f545cca1df23a0c21)), closes [#397](https://github.com/codewithagents/openapi-zod-ts/issues/397)

## [2.2.2](https://github.com/codewithagents/openapi-zod-ts/compare/openapi-zod-ts-v2.2.1...openapi-zod-ts-v2.2.2) (2026-06-23)


### Bug Fixes

* **openapi-zod-ts:** render nullable arrays (type: ["array","null"]) as z.array(...).nullable() ([#391](https://github.com/codewithagents/openapi-zod-ts/issues/391)) ([148c7dd](https://github.com/codewithagents/openapi-zod-ts/commit/148c7dd04efa22e6be81a6b486f21583c4e48edc))
* **openapi-zod-ts:** render nullable objects (type: ["object","null"]) concretely and guard against unknown fallbacks ([#393](https://github.com/codewithagents/openapi-zod-ts/issues/393)) ([306f620](https://github.com/codewithagents/openapi-zod-ts/commit/306f6205122149324e702335d4d0f1be9de02f5e))
* **openapi-zod-ts:** render structural members in multi-type unions; add schema-shape property tests ([#394](https://github.com/codewithagents/openapi-zod-ts/issues/394)) ([64a67ff](https://github.com/codewithagents/openapi-zod-ts/commit/64a67ff219e6ff5c5c50c25b374ee54b54e92405))

## [2.2.1](https://github.com/codewithagents/openapi-zod-ts/compare/openapi-zod-ts-v2.2.0...openapi-zod-ts-v2.2.1) (2026-06-23)


### Bug Fixes

* **openapi-zod-ts:** type lazy-wrapped cyclic schemas and disambiguate synthesized response schema names ([#383](https://github.com/codewithagents/openapi-zod-ts/issues/383)) ([#385](https://github.com/codewithagents/openapi-zod-ts/issues/385)) ([f05b0a4](https://github.com/codewithagents/openapi-zod-ts/commit/f05b0a4f217d688b1c0645d83c9a07f1b27ace33))

## [2.2.0](https://github.com/codewithagents/openapi-zod-ts/compare/openapi-zod-ts-v2.1.0...openapi-zod-ts-v2.2.0) (2026-06-21)


### ⚠ BREAKING CHANGES

* **openapi-zod-ts:** generated service interfaces and fetch clients now type request bodies as the XWritable variant for schemas with readOnly/writeOnly properties (directly or transitively). Service implementations and callers typed against the old base name must switch to the XWritable name.

### Features

* **openapi-zod-ts:** implement --reset-schema and align drift check with the bootstrapper ([#355](https://github.com/codewithagents/openapi-zod-ts/issues/355)) ([c86c335](https://github.com/codewithagents/openapi-zod-ts/commit/c86c335239e45b5ef32849dcf655335fe7971778))


### Bug Fixes

* **openapi-zod-ts:** derive read/write variants transitively so response types are the read shape ([#365](https://github.com/codewithagents/openapi-zod-ts/issues/365)) ([6337af1](https://github.com/codewithagents/openapi-zod-ts/commit/6337af17d47964e8e90393e594f1a5157d92fe26))


### Performance Improvements

* **ci:** carve the 128-spec compat matrix off the required gate, parallelize coverage ([#352](https://github.com/codewithagents/openapi-zod-ts/issues/352)) ([939ea00](https://github.com/codewithagents/openapi-zod-ts/commit/939ea0025e190c42e45c05f3c298d68adc014a60))

## [2.1.0](https://github.com/codewithagents/openapi-zod-ts/compare/openapi-zod-ts-v2.0.1...openapi-zod-ts-v2.1.0) (2026-06-21)


### ⚠ BREAKING CHANGES

* **openapi-server:** Fastify auth/context seam + global runtime hooks; opt-in CI drift gate (#335, #336, #337) ([#339](https://github.com/codewithagents/openapi-zod-ts/issues/339))
* createRouter(service) now returns a FastifyPluginAsyncZod plugin; mount via app.register(createRouter(service), { prefix }) instead of createRouter(instance, service).

### Features

* native zero-cast Fastify codegen (plugin factory, z.infer types, inline-response synthesis) ([#327](https://github.com/codewithagents/openapi-zod-ts/issues/327)) ([7f533d4](https://github.com/codewithagents/openapi-zod-ts/commit/7f533d49fce7de2b892dec54908a7390b6bb1091))
* **openapi-server:** Fastify auth/context seam + global runtime hooks; opt-in CI drift gate ([#335](https://github.com/codewithagents/openapi-zod-ts/issues/335), [#336](https://github.com/codewithagents/openapi-zod-ts/issues/336), [#337](https://github.com/codewithagents/openapi-zod-ts/issues/337)) ([#339](https://github.com/codewithagents/openapi-zod-ts/issues/339)) ([c4eb03e](https://github.com/codewithagents/openapi-zod-ts/commit/c4eb03e2ff763bc408a6d7ba3f6b5d1fbac91879))

## [2.0.1](https://github.com/codewithagents/openapi-zod-ts/compare/openapi-zod-ts-v2.0.0...openapi-zod-ts-v2.0.1) (2026-06-15)


### Bug Fixes

* **generator:** type nullable array query params as arrays ([#303](https://github.com/codewithagents/openapi-zod-ts/issues/303)) ([#304](https://github.com/codewithagents/openapi-zod-ts/issues/304)) ([751d25b](https://github.com/codewithagents/openapi-zod-ts/commit/751d25b14afca874e5fd76fa726483f60cdb3e7e))

## [2.0.0](https://github.com/codewithagents/openapi-zod-ts/compare/openapi-zod-ts-v1.1.0...openapi-zod-ts-v2.0.0) (2026-06-15)


### ⚠ BREAKING CHANGES

* **generator:** int64 fields previously generated as bigint / z.bigint(). Consumers who relied on bigint types for int64 fields must update their code. User-owned schemas.ts files containing z.bigint() for int64 properties will get TS compile errors and must be manually updated to z.number().

### Bug Fixes

* **generator:** codegen typing fixes for [#292](https://github.com/codewithagents/openapi-zod-ts/issues/292), [#293](https://github.com/codewithagents/openapi-zod-ts/issues/293), [#294](https://github.com/codewithagents/openapi-zod-ts/issues/294) ([#297](https://github.com/codewithagents/openapi-zod-ts/issues/297)) ([6ac859b](https://github.com/codewithagents/openapi-zod-ts/commit/6ac859b8b5a8dcd806222ea9b24f732b63650210))
* **generator:** codegen typing fixes for [#298](https://github.com/codewithagents/openapi-zod-ts/issues/298), [#299](https://github.com/codewithagents/openapi-zod-ts/issues/299), [#300](https://github.com/codewithagents/openapi-zod-ts/issues/300) ([#301](https://github.com/codewithagents/openapi-zod-ts/issues/301)) ([42d2f66](https://github.com/codewithagents/openapi-zod-ts/commit/42d2f66336de796dff65454c3875dfd9164c4692))

## [1.1.0](https://github.com/codewithagents/openapi-zod-ts/compare/openapi-zod-ts-v1.0.1...openapi-zod-ts-v1.1.0) (2026-06-10)


### Features

* **config:** multi-spec projects array drives N generations from one file ([#238](https://github.com/codewithagents/openapi-zod-ts/issues/238)) ([#288](https://github.com/codewithagents/openapi-zod-ts/issues/288)) ([aab136b](https://github.com/codewithagents/openapi-zod-ts/commit/aab136b6e20972dd51528f55b7ec5aecfc57b34f))


### Bug Fixes

* **client:** add Accept: application/json header to all generated fetch requests ([#290](https://github.com/codewithagents/openapi-zod-ts/issues/290)) ([6e8b895](https://github.com/codewithagents/openapi-zod-ts/commit/6e8b8958167fc16cd97e0ae8e7c3fccb3ef4ca81))

## [1.0.1](https://github.com/codewithagents/openapi-zod-ts/compare/openapi-zod-ts-v1.0.0...openapi-zod-ts-v1.0.1) (2026-06-03)


### Bug Fixes

* **client:** guard against 204 no-content before res.json(), fixes [#272](https://github.com/codewithagents/openapi-zod-ts/issues/272) ([25320bd](https://github.com/codewithagents/openapi-zod-ts/commit/25320bd5bf4f5439448585f4a3b50ad1b6e395ed))

## 1.0.0 (2026-06-03)


### Miscellaneous

* Renamed from `@codewithagents/openapi-gen` to **`openapi-zod-ts`**. The generator is unchanged; install `openapi-zod-ts` instead. The CLI bin and default config file are now `openapi-zod-ts` / `openapi-zod-ts.config.json`. The prior package `@codewithagents/openapi-gen` (last release 4.9.1) is deprecated. ([#266](https://github.com/codewithagents/openapi-zod-ts/issues/266))

---

_Versions below were published under the previous name `@codewithagents/openapi-gen`._

## [4.9.1](https://github.com/codewithagents/openapi-zod-ts/compare/openapi-gen-v4.9.0...openapi-gen-v4.9.1) (2026-06-02)


### Bug Fixes

* **openapi-gen:** deprecate in favor of openapi-zod-ts ([#265](https://github.com/codewithagents/openapi-zod-ts/issues/265)) ([401790d](https://github.com/codewithagents/openapi-zod-ts/commit/401790d6a4f54e901545e23557969f058b1f1711))
* **openapi-gen:** rewrite normalizeQueryParamName to linear time ([#261](https://github.com/codewithagents/openapi-zod-ts/issues/261)) ([#264](https://github.com/codewithagents/openapi-zod-ts/issues/264)) ([635796c](https://github.com/codewithagents/openapi-zod-ts/commit/635796c8111882bdfdc9b353491a39a8fbf4eb2e))
* **openapi-react-query:** emit and thread params arg when client requires it ([#259](https://github.com/codewithagents/openapi-zod-ts/issues/259)) ([#260](https://github.com/codewithagents/openapi-zod-ts/issues/260)) ([0619b7f](https://github.com/codewithagents/openapi-zod-ts/commit/0619b7f7b7a4a2f125355009fa45ff15b3434726))
* **openapi-react-query:** mirror client operationId uniquification in hooks ([#254](https://github.com/codewithagents/openapi-zod-ts/issues/254)) ([#257](https://github.com/codewithagents/openapi-zod-ts/issues/257)) ([d128037](https://github.com/codewithagents/openapi-zod-ts/commit/d128037dfd0d1e08498e9981afbd86e162222d40))

## [4.9.0](https://github.com/codewithagents/openapi-zod-ts/compare/openapi-gen-v4.8.0...openapi-gen-v4.9.0) (2026-06-02)


### Features

* **cli:** shared cli-core eliminates byte-identical parseCliArgs across packages ([#238](https://github.com/codewithagents/openapi-zod-ts/issues/238)) ([#252](https://github.com/codewithagents/openapi-zod-ts/issues/252)) ([200af1f](https://github.com/codewithagents/openapi-zod-ts/commit/200af1fcb94bb570bc18d79eedfdd3e0125c8d85))


### Bug Fixes

* **openapi-gen,react-query:** share operation-name derivation so client and hooks agree ([#241](https://github.com/codewithagents/openapi-zod-ts/issues/241)) ([#255](https://github.com/codewithagents/openapi-zod-ts/issues/255)) ([5680f19](https://github.com/codewithagents/openapi-zod-ts/commit/5680f19ac445f95954236e5553a96e9882d3f77c))
* **openapi-react-query:** type mutation variables as the writable variant; single writableVariantMap ([#242](https://github.com/codewithagents/openapi-zod-ts/issues/242), [#243](https://github.com/codewithagents/openapi-zod-ts/issues/243)) ([#256](https://github.com/codewithagents/openapi-zod-ts/issues/256)) ([ecf7c36](https://github.com/codewithagents/openapi-zod-ts/commit/ecf7c36b83c7330e1406fa866b0eb528c09879e5))

## [4.8.0](https://github.com/codewithagents/openapi-zod-ts/compare/openapi-gen-v4.7.0...openapi-gen-v4.8.0) (2026-06-01)


### Features

* **config:** shared config-core + JS config support for react-query/server ([#238](https://github.com/codewithagents/openapi-zod-ts/issues/238)) ([#239](https://github.com/codewithagents/openapi-zod-ts/issues/239)) ([b4559a9](https://github.com/codewithagents/openapi-zod-ts/commit/b4559a96bef3396dbd24ddfec0e2799ee93c7d9d))

## [4.7.0](https://github.com/codewithagents/openapi-zod-ts/compare/openapi-gen-v4.6.1...openapi-gen-v4.7.0) (2026-06-01)


### Features

* **openapi-gen:** DX core — --input/--output flags, JS config + defineConfig, --watch ([#192](https://github.com/codewithagents/openapi-zod-ts/issues/192)) ([#236](https://github.com/codewithagents/openapi-zod-ts/issues/236)) ([0cf3959](https://github.com/codewithagents/openapi-zod-ts/commit/0cf3959818b396efeda6ec53defb88f9891912ea))
* **openapi-gen:** readOnly/writeOnly request/response type variant split ([#211](https://github.com/codewithagents/openapi-zod-ts/issues/211)) ([#237](https://github.com/codewithagents/openapi-zod-ts/issues/237)) ([7e78796](https://github.com/codewithagents/openapi-zod-ts/commit/7e78796d4408d57817df83cee4137bc816c0c8a4))


### Bug Fixes

* **openapi-gen:** resolve deep/non-component $refs; empty tsc-gate allowlist ([#220](https://github.com/codewithagents/openapi-zod-ts/issues/220)) ([#235](https://github.com/codewithagents/openapi-zod-ts/issues/235)) ([0f5a8d4](https://github.com/codewithagents/openapi-zod-ts/commit/0f5a8d4252fbfd4b417ad8cb9aa6b7f167193fb3))

## [4.6.1](https://github.com/codewithagents/openapi-zod-ts/compare/openapi-gen-v4.6.0...openapi-gen-v4.6.1) (2026-06-01)


### Bug Fixes

* **openapi-gen:** coerce non-string header values to string in generated client ([#221](https://github.com/codewithagents/openapi-zod-ts/issues/221)) ([#230](https://github.com/codewithagents/openapi-zod-ts/issues/230)) ([665d777](https://github.com/codewithagents/openapi-zod-ts/commit/665d7776c0fc99f303150328a0bb0e40076c6d4e))
* **openapi-gen:** de-duplicate colliding generated type & param identifiers ([#219](https://github.com/codewithagents/openapi-zod-ts/issues/219)) ([#229](https://github.com/codewithagents/openapi-zod-ts/issues/229)) ([f740caf](https://github.com/codewithagents/openapi-zod-ts/commit/f740cafc5cbb9fa03955ab536688bd181586f32b))
* **openapi-gen:** protect client-internal names from spec collisions + import form-body types ([#218](https://github.com/codewithagents/openapi-zod-ts/issues/218)) ([#231](https://github.com/codewithagents/openapi-zod-ts/issues/231)) ([f4defe0](https://github.com/codewithagents/openapi-zod-ts/commit/f4defe0683075e4d012753bb8aec24f6a4cdd989))

## [4.6.0](https://github.com/codewithagents/openapi-zod-ts/compare/openapi-gen-v4.5.0...openapi-gen-v4.6.0) (2026-06-01)


### Features

* **openapi-gen:** add signal/timeout, request interceptor + fetch override, and generic ApiError ([#186](https://github.com/codewithagents/openapi-zod-ts/issues/186)) ([#224](https://github.com/codewithagents/openapi-zod-ts/issues/224)) ([036cb83](https://github.com/codewithagents/openapi-zod-ts/commit/036cb835354510b0d95270af27dabc08e054f90a))


### Bug Fixes

* **openapi-gen:** widen non-primitive enum values + repair compat-matrix tsc gate ([#214](https://github.com/codewithagents/openapi-zod-ts/issues/214)) ([#222](https://github.com/codewithagents/openapi-zod-ts/issues/222)) ([0bb7c63](https://github.com/codewithagents/openapi-zod-ts/commit/0bb7c633088240fb22a5c356002948d0214ec6af))

## [4.5.0](https://github.com/codewithagents/openapi-zod-ts/compare/openapi-gen-v4.4.0...openapi-gen-v4.5.0) (2026-06-01)


### Features

* **openapi-gen:** handle int64/bigint, zod v4 validators, default/const/strict/tuple keywords ([#185](https://github.com/codewithagents/openapi-zod-ts/issues/185)) ([#210](https://github.com/codewithagents/openapi-zod-ts/issues/210)) ([78c6922](https://github.com/codewithagents/openapi-zod-ts/commit/78c6922ac6ff68d60a76ec8e23f6d7a86157a392))


### Bug Fixes

* **openapi-gen:** de-duplicate colliding generated function names ([#182](https://github.com/codewithagents/openapi-zod-ts/issues/182)) ([#206](https://github.com/codewithagents/openapi-zod-ts/issues/206)) ([858d53c](https://github.com/codewithagents/openapi-zod-ts/commit/858d53c4b07d245d81c0e8c282149ac60987c8bf))
* **openapi-gen:** merge allOf siblings and required arrays ([#184](https://github.com/codewithagents/openapi-zod-ts/issues/184)) ([#207](https://github.com/codewithagents/openapi-zod-ts/issues/207)) ([ede8dc4](https://github.com/codewithagents/openapi-zod-ts/commit/ede8dc4f979c4f2232d0268b639658bcadf5331a))
* **openapi-gen:** support apiKey header/query and basic auth schemes ([#183](https://github.com/codewithagents/openapi-zod-ts/issues/183)) ([#213](https://github.com/codewithagents/openapi-zod-ts/issues/213)) ([7ca44ec](https://github.com/codewithagents/openapi-zod-ts/commit/7ca44ec72ebd39b8ec48c112bd1dd52ca8fce07d))

## [4.4.0](https://github.com/codewithagents/openapi-zod-ts/compare/openapi-gen-v4.3.2...openapi-gen-v4.4.0) (2026-06-01)


### Features

* **cli:** add --help and --version to all three CLIs ([#178](https://github.com/codewithagents/openapi-zod-ts/issues/178)) ([#203](https://github.com/codewithagents/openapi-zod-ts/issues/203)) ([6f641e0](https://github.com/codewithagents/openapi-zod-ts/commit/6f641e05d3d19c1a4394247c3c079556e8a52274))


### Bug Fixes

* **openapi-gen:** encode application/x-www-form-urlencoded request bodies ([#176](https://github.com/codewithagents/openapi-zod-ts/issues/176)) ([#201](https://github.com/codewithagents/openapi-zod-ts/issues/201)) ([15a5138](https://github.com/codewithagents/openapi-zod-ts/commit/15a5138e28dac55760e839c5cbea1e2d8e6ffa38))
* **openapi-gen:** normalize OpenAPI 3.0 nullable into the 3.1 null union ([#179](https://github.com/codewithagents/openapi-zod-ts/issues/179)) ([#204](https://github.com/codewithagents/openapi-zod-ts/issues/204)) ([12ff9c0](https://github.com/codewithagents/openapi-zod-ts/commit/12ff9c01a1e6ee3daa11d92d9e1de6daf5edde06))
* **openapi-gen:** parse non-JSON responses (text/blob/stream) instead of always res.json() ([#175](https://github.com/codewithagents/openapi-zod-ts/issues/175)) ([#200](https://github.com/codewithagents/openapi-zod-ts/issues/200)) ([2b88f5b](https://github.com/codewithagents/openapi-zod-ts/commit/2b88f5b8e307b2b9a80816dd2667a5eb6125f554))

## [4.3.2](https://github.com/codewithagents/openapi-zod-ts/compare/openapi-gen-v4.3.1...openapi-gen-v4.3.2) (2026-05-31)


### Bug Fixes

* **security:** bound schema nesting depth to prevent recursion DoS ([#172](https://github.com/codewithagents/openapi-zod-ts/issues/172)) ([a7dc2a6](https://github.com/codewithagents/openapi-zod-ts/commit/a7dc2a6363a306eedca9e9f2e0f9b4a597dbba7b))
* **security:** escape spec-derived strings in generated code ([#169](https://github.com/codewithagents/openapi-zod-ts/issues/169)) ([35f232d](https://github.com/codewithagents/openapi-zod-ts/commit/35f232dbb6b4baaea652a87f44bbd9f4e2f3046c))

## [4.3.1](https://github.com/codewithagents/openapi-zod-ts/compare/openapi-gen-v4.3.0...openapi-gen-v4.3.1) (2026-05-31)


### Bug Fixes

* add consistent package metadata (homepage, bugs, author) across all packages ([#166](https://github.com/codewithagents/openapi-zod-ts/issues/166)) ([dc2c1d3](https://github.com/codewithagents/openapi-zod-ts/commit/dc2c1d327e87dabbe07450a1664ba6158aff82de))

## [4.3.0](https://github.com/codewithagents/openapi-ts/compare/openapi-gen-v4.2.0...openapi-gen-v4.3.0) (2026-05-30)


### Features

* **openapi-server:** add Express and Fastify router generation with Zod validation ([a1a9d53](https://github.com/codewithagents/openapi-ts/commit/a1a9d5390ae8584afee183835d0976bae4239d28))


### Bug Fixes

* resolve CodeQL security findings ([1775358](https://github.com/codewithagents/openapi-ts/commit/17753583a2ae32fdd16e45cd476de74119c6a6ba))

## [4.2.0](https://github.com/codewithagents/glue/compare/openapi-gen-v4.1.0...openapi-gen-v4.2.0) (2026-05-29)


### Features

* **smoke:** expand to 9 real API requests, run on every push to main ([#144](https://github.com/codewithagents/glue/issues/144)) ([ba0c7c3](https://github.com/codewithagents/glue/commit/ba0c7c39c97f4f0a152fed67676346c035de90fd))

## [4.1.0](https://github.com/codewithagents/glue/compare/openapi-gen-v4.0.0...openapi-gen-v4.1.0) (2026-05-29)


### Features

* examples directory — 11 real-world specs, 7 generator bug fixes ([#137](https://github.com/codewithagents/glue/issues/137)) ([66edd3f](https://github.com/codewithagents/glue/commit/66edd3feacad868ed24058370c910628ccd7dc5a))


### Bug Fixes

* **coverage:** use lcov projectRoot option to emit repo-relative SF paths ([8cefc4f](https://github.com/codewithagents/glue/commit/8cefc4fa39755c923b97c0938ccec72b3fe3768f))
* generator handles 127/128 real-world specs + docs update ([#139](https://github.com/codewithagents/glue/issues/139)) ([07fcd2a](https://github.com/codewithagents/glue/commit/07fcd2a4c7c9e92b91ea0b3754e9774cf7ff1439))

## [4.0.0](https://github.com/codewithagents/glue/compare/openapi-gen-v3.5.0...openapi-gen-v4.0.0) (2026-05-27)


### ⚠ BREAKING CHANGES

* generated files are now Prettier-formatted. Re-generate after upgrading if you run prettier --check on committed output.

### Features

* format generated output with Prettier; ESLint validation in integration ([#131](https://github.com/codewithagents/glue/issues/131)) ([c1db744](https://github.com/codewithagents/glue/commit/c1db744c677655d541a943122f16e00dab6373e3))
* YAML/Zod pipeline tests + openapi-server Prettier and 1.0.0 ([#133](https://github.com/codewithagents/glue/issues/133)) ([8ec2f1e](https://github.com/codewithagents/glue/commit/8ec2f1ec17486fc3645939e515cbb401500927f3))

## [3.5.0](https://github.com/codewithagents/glue/compare/openapi-gen-v3.4.0...openapi-gen-v3.5.0) (2026-05-27)


### Features

* **openapi-gen:** feature-conditional _request helpers — only emit auth/credentials/extraHeaders when spec declares them ([#129](https://github.com/codewithagents/glue/issues/129)) ([a24ef4b](https://github.com/codewithagents/glue/commit/a24ef4b3edbeab1871082d249a279e18a19dd603))

## [3.4.0](https://github.com/codewithagents/glue/compare/openapi-gen-v3.3.2...openapi-gen-v3.4.0) (2026-05-27)


### Features

* **openapi-gen:** extract shared _request / _requestForm helpers in generated client ([#125](https://github.com/codewithagents/glue/issues/125)) ([a63eae3](https://github.com/codewithagents/glue/commit/a63eae3061e33b1007978fa8531b41ff6852c5e8)), closes [#124](https://github.com/codewithagents/glue/issues/124)

## [3.3.2](https://github.com/codewithagents/glue/compare/openapi-gen-v3.3.1...openapi-gen-v3.3.2) (2026-05-27)


### Bug Fixes

* **openapi-gen:** document zod schema topological sort in CLAUDE.md ([#119](https://github.com/codewithagents/glue/issues/119)) ([9d6929a](https://github.com/codewithagents/glue/commit/9d6929ac2757e386960b9e822ba09c4b78a5b7c0))

## [3.3.1](https://github.com/codewithagents/glue/compare/openapi-gen-v3.3.0...openapi-gen-v3.3.1) (2026-05-26)


### Bug Fixes

* **openapi-gen:** topological sort schemas to prevent forward reference errors ([#114](https://github.com/codewithagents/glue/issues/114)) ([81329f3](https://github.com/codewithagents/glue/commit/81329f390f0b401cd7acfa103ec7a3dc33341ee0)), closes [#110](https://github.com/codewithagents/glue/issues/110)

## [3.3.0](https://github.com/codewithagents/glue/compare/openapi-gen-v3.2.0...openapi-gen-v3.3.0) (2026-05-26)


### Features

* **openapi-gen:** emit XxxValues array for string enums ([#108](https://github.com/codewithagents/glue/issues/108)) ([d225f26](https://github.com/codewithagents/glue/commit/d225f2698083196b98b875009a20f3eb21b7b32a))

## [3.2.0](https://github.com/codewithagents/glue/compare/openapi-gen-v3.1.1...openapi-gen-v3.2.0) (2026-05-26)


### Features

* **openapi-gen:** schema-enhanced generation with Zod validation ([#100](https://github.com/codewithagents/glue/issues/100)) ([6fc0af1](https://github.com/codewithagents/glue/commit/6fc0af19ea8b62840696805958c4181a6633d1fc))


### Bug Fixes

* **openapi-gen:** use .strip() for request body validation to support form wizard schemas ([#101](https://github.com/codewithagents/glue/issues/101)) ([39acdb1](https://github.com/codewithagents/glue/commit/39acdb13a3e1761c464385b9afbe7ea561bf3636))

## [3.1.1](https://github.com/codewithagents/glue/compare/openapi-gen-v3.1.0...openapi-gen-v3.1.1) (2026-05-25)


### Bug Fixes

* **openapi-gen:** bundle CLI with esbuild to prevent ajv hoisting crash ([#85](https://github.com/codewithagents/glue/issues/85)) ([#88](https://github.com/codewithagents/glue/issues/88)) ([7ca2e1c](https://github.com/codewithagents/glue/commit/7ca2e1c130e2f0639ab060b3bb495acbc6fe09a2))

## [3.1.0](https://github.com/codewithagents/glue/compare/openapi-gen-v3.0.0...openapi-gen-v3.1.0) (2026-05-25)


### Features

* **integration:** consumer type simulation + CI path validation tests ([#77](https://github.com/codewithagents/glue/issues/77)) ([8a4a2b4](https://github.com/codewithagents/glue/commit/8a4a2b40987fcd25fdf5fe5d5f5a6f84fd9b95df))

## [3.0.0](https://github.com/codewithagents/glue/compare/openapi-gen-v2.0.1...openapi-gen-v3.0.0) (2026-05-25)


### ⚠ BREAKING CHANGES

* **openapi-gen:** The generated client.ts now emits a multi-line error block (create err, call onError?.(err), throw) instead of a single throw statement. Any code that pattern-matched on the generated output shape will need updating. Config format, generated file names, and TypeScript types are stable from this version forward.

### Features

* add integration package + ApiError body unwrapping + coverage cleanup ([#31](https://github.com/codewithagents/glue/issues/31)) ([f200c7b](https://github.com/codewithagents/glue/commit/f200c7b662f743c41699c177ce37ab1069404d52))
* **cli:** add --config flag to openapi-gen and openapi-react-query with path security validation ([#38](https://github.com/codewithagents/glue/issues/38)) ([56c4352](https://github.com/codewithagents/glue/commit/56c435213dd59fd856e11102a22c12eb0d7aa0e4))
* **openapi-gen:** add Zod validation constraints from OpenAPI schema ([#28](https://github.com/codewithagents/glue/issues/28)) ([058bf01](https://github.com/codewithagents/glue/commit/058bf01cf0a4cdaf9e5ba5ac19124cab55f29129))
* **openapi-gen:** deprecated JSDoc, numeric enums, date-time format, typed error unions, discriminated unions ([b23bd69](https://github.com/codewithagents/glue/commit/b23bd69000ea9ca24a9188863ecb5a6ad5b18fc8))
* **openapi-gen:** enum query params, barrel index.ts, YAML spec support ([#15](https://github.com/codewithagents/glue/issues/15)) ([6427556](https://github.com/codewithagents/glue/commit/64275567e08fd0c801f2a6fb4700edc269f6f54a))
* **openapi-gen:** header params, cookie auth, multipart bodies, array query serialization ([#33](https://github.com/codewithagents/glue/issues/33)) ([dbfc3da](https://github.com/codewithagents/glue/commit/dbfc3da28593521e6c9832507fc684b7d2ca82cd))
* **openapi-gen:** stable 1.0 API — onError hook ([#17](https://github.com/codewithagents/glue/issues/17)) ([6e5ccb9](https://github.com/codewithagents/glue/commit/6e5ccb9a4cd87a9dbc3516eb36581cdd1f49abb0))
* React Query enhancements — nullish params, suspense, auto-invalidate, per-resource cache, server client ([#67](https://github.com/codewithagents/glue/issues/67)) ([6a407ea](https://github.com/codewithagents/glue/commit/6a407eab12c66d0d4baba571e11538bcfa898e1a))
* Zod v4 schema bootstrap from OpenAPI spec ([#9](https://github.com/codewithagents/glue/issues/9)) ([132b571](https://github.com/codewithagents/glue/commit/132b5716a90784f14c6bd13aa607ec98b1d1a71b))


### Bug Fixes

* CI path false positive, onSuccess spread, explicit server client signatures ([#72](https://github.com/codewithagents/glue/issues/72)) ([ec25bb0](https://github.com/codewithagents/glue/commit/ec25bb0c0f5df8a20c2b31a1aa499408a0ed3fcc))
* CI path false positive, onSuccess spread, explicit server client signatures ([#73](https://github.com/codewithagents/glue/issues/73)) ([f21d93d](https://github.com/codewithagents/glue/commit/f21d93d63e57ed97380820788a3ed9ad75e4adc9))
* **openapi-gen:** add repository URL and executable bit for npm provenance ([#25](https://github.com/codewithagents/glue/issues/25)) ([53ce21d](https://github.com/codewithagents/glue/commit/53ce21d7d7c964ab49ec588378c12b5225f1b6a8))
* **openapi-gen:** emit values array alongside numeric enum type ([3ca3dac](https://github.com/codewithagents/glue/commit/3ca3dac7f0fe3ffa1be43ac9ced0dd54fc8b66ee))
* **openapi-gen:** required params, inline type guards, real-world fixture coverage ([#12](https://github.com/codewithagents/glue/issues/12)) ([1cb4d6f](https://github.com/codewithagents/glue/commit/1cb4d6f0321a3a77e63a9b13d649962f6f566c68))
* **openapi-gen:** resolve $ref parameters from components, add minItems/maxItems to Zod arrays ([#35](https://github.com/codewithagents/glue/issues/35)) ([2076c24](https://github.com/codewithagents/glue/commit/2076c2499a10a35bcbea997b30afec6134528378))

## [2.0.1](https://github.com/codewithagents/glue/compare/openapi-gen-v2.0.0...openapi-gen-v2.0.1) (2026-05-25)


### Bug Fixes

* CI path false positive, onSuccess spread, explicit server client signatures ([#72](https://github.com/codewithagents/glue/issues/72)) ([ec25bb0](https://github.com/codewithagents/glue/commit/ec25bb0c0f5df8a20c2b31a1aa499408a0ed3fcc))

## [2.0.0](https://github.com/codewithagents/glue/compare/openapi-gen-v1.5.1...openapi-gen-v2.0.0) (2026-05-25)


### ⚠ BREAKING CHANGES

* **openapi-gen:** The generated client.ts now emits a multi-line error block (create err, call onError?.(err), throw) instead of a single throw statement. Any code that pattern-matched on the generated output shape will need updating. Config format, generated file names, and TypeScript types are stable from this version forward.

### Features

* add integration package + ApiError body unwrapping + coverage cleanup ([#31](https://github.com/codewithagents/glue/issues/31)) ([f200c7b](https://github.com/codewithagents/glue/commit/f200c7b662f743c41699c177ce37ab1069404d52))
* **cli:** add --config flag to openapi-gen and openapi-react-query with path security validation ([#38](https://github.com/codewithagents/glue/issues/38)) ([56c4352](https://github.com/codewithagents/glue/commit/56c435213dd59fd856e11102a22c12eb0d7aa0e4))
* **openapi-gen:** add Zod validation constraints from OpenAPI schema ([#28](https://github.com/codewithagents/glue/issues/28)) ([058bf01](https://github.com/codewithagents/glue/commit/058bf01cf0a4cdaf9e5ba5ac19124cab55f29129))
* **openapi-gen:** deprecated JSDoc, numeric enums, date-time format, typed error unions, discriminated unions ([b23bd69](https://github.com/codewithagents/glue/commit/b23bd69000ea9ca24a9188863ecb5a6ad5b18fc8))
* **openapi-gen:** enum query params, barrel index.ts, YAML spec support ([#15](https://github.com/codewithagents/glue/issues/15)) ([6427556](https://github.com/codewithagents/glue/commit/64275567e08fd0c801f2a6fb4700edc269f6f54a))
* **openapi-gen:** header params, cookie auth, multipart bodies, array query serialization ([#33](https://github.com/codewithagents/glue/issues/33)) ([dbfc3da](https://github.com/codewithagents/glue/commit/dbfc3da28593521e6c9832507fc684b7d2ca82cd))
* **openapi-gen:** stable 1.0 API — onError hook ([#17](https://github.com/codewithagents/glue/issues/17)) ([6e5ccb9](https://github.com/codewithagents/glue/commit/6e5ccb9a4cd87a9dbc3516eb36581cdd1f49abb0))
* Zod v4 schema bootstrap from OpenAPI spec ([#9](https://github.com/codewithagents/glue/issues/9)) ([132b571](https://github.com/codewithagents/glue/commit/132b5716a90784f14c6bd13aa607ec98b1d1a71b))


### Bug Fixes

* **openapi-gen:** add repository URL and executable bit for npm provenance ([#25](https://github.com/codewithagents/glue/issues/25)) ([53ce21d](https://github.com/codewithagents/glue/commit/53ce21d7d7c964ab49ec588378c12b5225f1b6a8))
* **openapi-gen:** emit values array alongside numeric enum type ([3ca3dac](https://github.com/codewithagents/glue/commit/3ca3dac7f0fe3ffa1be43ac9ced0dd54fc8b66ee))
* **openapi-gen:** required params, inline type guards, real-world fixture coverage ([#12](https://github.com/codewithagents/glue/issues/12)) ([1cb4d6f](https://github.com/codewithagents/glue/commit/1cb4d6f0321a3a77e63a9b13d649962f6f566c68))
* **openapi-gen:** resolve $ref parameters from components, add minItems/maxItems to Zod arrays ([#35](https://github.com/codewithagents/glue/issues/35)) ([2076c24](https://github.com/codewithagents/glue/commit/2076c2499a10a35bcbea997b30afec6134528378))

## [1.4.0](https://github.com/codewithagents/glue/compare/openapi-gen-v1.3.1...openapi-gen-v1.4.0) (2026-05-24)


### Features

* **cli:** add --config flag to openapi-gen and openapi-react-query with path security validation ([#38](https://github.com/codewithagents/glue/issues/38)) ([56c4352](https://github.com/codewithagents/glue/commit/56c435213dd59fd856e11102a22c12eb0d7aa0e4))

## [1.3.1](https://github.com/codewithagents/glue/compare/openapi-gen-v1.3.0...openapi-gen-v1.3.1) (2026-05-23)


### Bug Fixes

* **openapi-gen:** resolve $ref parameters from components, add minItems/maxItems to Zod arrays ([#35](https://github.com/codewithagents/glue/issues/35)) ([2076c24](https://github.com/codewithagents/glue/commit/2076c2499a10a35bcbea997b30afec6134528378))

## [1.3.0](https://github.com/codewithagents/glue/compare/openapi-gen-v1.2.0...openapi-gen-v1.3.0) (2026-05-23)


### Features

* **openapi-gen:** header params, cookie auth, multipart bodies, array query serialization ([#33](https://github.com/codewithagents/glue/issues/33)) ([dbfc3da](https://github.com/codewithagents/glue/commit/dbfc3da28593521e6c9832507fc684b7d2ca82cd))

## [1.2.0](https://github.com/codewithagents/glue/compare/openapi-gen-v1.1.0...openapi-gen-v1.2.0) (2026-05-23)


### Features

* add integration package + ApiError body unwrapping + coverage cleanup ([#31](https://github.com/codewithagents/glue/issues/31)) ([f200c7b](https://github.com/codewithagents/glue/commit/f200c7b662f743c41699c177ce37ab1069404d52))

## [1.1.0](https://github.com/codewithagents/glue/compare/openapi-gen-v1.0.1...openapi-gen-v1.1.0) (2026-05-23)


### Features

* **openapi-gen:** add Zod validation constraints from OpenAPI schema ([#28](https://github.com/codewithagents/glue/issues/28)) ([058bf01](https://github.com/codewithagents/glue/commit/058bf01cf0a4cdaf9e5ba5ac19124cab55f29129))

## [1.0.1](https://github.com/codewithagents/glue/compare/openapi-gen-v1.0.0...openapi-gen-v1.0.1) (2026-05-23)


### Bug Fixes

* **openapi-gen:** add repository URL and executable bit for npm provenance ([#25](https://github.com/codewithagents/glue/issues/25)) ([53ce21d](https://github.com/codewithagents/glue/commit/53ce21d7d7c964ab49ec588378c12b5225f1b6a8))

## [1.0.0](https://github.com/codewithagents/glue/compare/openapi-gen-v0.3.0...openapi-gen-v1.0.0) (2026-05-23)


### ⚠ BREAKING CHANGES

* **openapi-gen:** The generated client.ts now emits a multi-line error block (create err, call onError?.(err), throw) instead of a single throw statement. Any code that pattern-matched on the generated output shape will need updating. Config format, generated file names, and TypeScript types are stable from this version forward.

### Features

* **openapi-gen:** stable 1.0 API — onError hook ([#17](https://github.com/codewithagents/glue/issues/17)) ([6e5ccb9](https://github.com/codewithagents/glue/commit/6e5ccb9a4cd87a9dbc3516eb36581cdd1f49abb0))

## [0.3.0](https://github.com/codewithagents/glue/compare/openapi-gen-v0.2.1...openapi-gen-v0.3.0) (2026-05-23)


### Features

* **openapi-gen:** enum query params, barrel index.ts, YAML spec support ([#15](https://github.com/codewithagents/glue/issues/15)) ([6427556](https://github.com/codewithagents/glue/commit/64275567e08fd0c801f2a6fb4700edc269f6f54a))

## [0.2.1](https://github.com/codewithagents/glue/compare/openapi-gen-v0.2.0...openapi-gen-v0.2.1) (2026-05-23)


### Bug Fixes

* **openapi-gen:** required params, inline type guards, real-world fixture coverage ([#12](https://github.com/codewithagents/glue/issues/12)) ([1cb4d6f](https://github.com/codewithagents/glue/commit/1cb4d6f0321a3a77e63a9b13d649962f6f566c68))

## [0.2.0](https://github.com/codewithagents/glue/compare/openapi-gen-v0.1.0...openapi-gen-v0.2.0) (2026-05-23)


### Features

* Zod v4 schema bootstrap from OpenAPI spec ([#9](https://github.com/codewithagents/glue/issues/9)) ([132b571](https://github.com/codewithagents/glue/commit/132b5716a90784f14c6bd13aa607ec98b1d1a71b))
