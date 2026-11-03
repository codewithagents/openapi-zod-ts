# Changelog

## [2.3.0](https://github.com/codewithagents/openapi-zod-ts/compare/openapi-server-v2.2.2...openapi-server-v2.3.0) (2026-11-03)


### Features

* **openapi-server:** opt-in RFC 7807 problem+json errors ([9a1b937](https://github.com/codewithagents/openapi-zod-ts/commit/9a1b937ed486d801af9e360cfe7a2dd2f7b082df))
* **openapi-server:** response validation for Hono and Express ([9a1b937](https://github.com/codewithagents/openapi-zod-ts/commit/9a1b937ed486d801af9e360cfe7a2dd2f7b082df))
* **openapi-server:** spec_prefix for sharing one schemas.ts across specs ([9a1b937](https://github.com/codewithagents/openapi-zod-ts/commit/9a1b937ed486d801af9e360cfe7a2dd2f7b082df))


### Bug Fixes

* **openapi-server:** coerce scalar boolean query params in Hono and Fastify ([9a1b937](https://github.com/codewithagents/openapi-zod-ts/commit/9a1b937ed486d801af9e360cfe7a2dd2f7b082df))
* **openapi-server:** keep absent optional query params undefined in Express ([9a1b937](https://github.com/codewithagents/openapi-zod-ts/commit/9a1b937ed486d801af9e360cfe7a2dd2f7b082df))

## [2.2.2](https://github.com/codewithagents/openapi-zod-ts/compare/openapi-server-v2.2.1...openapi-server-v2.2.2) (2026-11-03)


### Bug Fixes

* **deps:** update all dependencies to latest ([#444](https://github.com/codewithagents/openapi-zod-ts/issues/444)) ([38de74e](https://github.com/codewithagents/openapi-zod-ts/commit/38de74ebf2836542b2fbe04f0d99f7b236d8fdf7))

## [2.2.1](https://github.com/codewithagents/openapi-zod-ts/compare/openapi-server-v2.2.0...openapi-server-v2.2.1) (2026-07-04)


### Bug Fixes

* **openapi-server:** handle explode:true array query params in hono/express routers ([#407](https://github.com/codewithagents/openapi-zod-ts/issues/407)) ([a4805b7](https://github.com/codewithagents/openapi-zod-ts/commit/a4805b70772ef3b8717ae292e177e9ed3ac68949))
* **openapi-server:** widen fastify-type-provider-zod peer range to ^6 || ^7 ([#406](https://github.com/codewithagents/openapi-zod-ts/issues/406)) ([0476ac9](https://github.com/codewithagents/openapi-zod-ts/commit/0476ac983122bcac3177fbeac20ea2fe2eacbf7b))

## [2.2.0](https://github.com/codewithagents/openapi-zod-ts/compare/openapi-server-v2.1.1...openapi-server-v2.2.0) (2026-06-23)


### Features

* **openapi-server:** expose @fastify/multipart limits via CreateRouterOptions ([#389](https://github.com/codewithagents/openapi-zod-ts/issues/389)) ([d715842](https://github.com/codewithagents/openapi-zod-ts/commit/d715842fedb9f7d8cb25b4078dc7efd3662c3658))


### Bug Fixes

* **openapi-server:** register @fastify/multipart with attachFieldsToBody 'keyValues' ([#384](https://github.com/codewithagents/openapi-zod-ts/issues/384)) ([#387](https://github.com/codewithagents/openapi-zod-ts/issues/387)) ([caa31da](https://github.com/codewithagents/openapi-zod-ts/commit/caa31dae5124ef00fc15864e4ef326590e6dafc1))

## [2.1.1](https://github.com/codewithagents/openapi-zod-ts/compare/openapi-server-v2.1.0...openapi-server-v2.1.1) (2026-06-22)


### Bug Fixes

* **openapi-server:** record array query service type and non-object path-item warning ([4796e5e](https://github.com/codewithagents/openapi-zod-ts/commit/4796e5ed253565b8408bc9361f323a98be9170aa))

## [2.1.0](https://github.com/codewithagents/openapi-zod-ts/compare/openapi-server-v2.0.0...openapi-server-v2.1.0) (2026-06-21)


### ⚠ BREAKING CHANGES

* **openapi-zod-ts:** generated service interfaces and fetch clients now type request bodies as the XWritable variant for schemas with readOnly/writeOnly properties (directly or transitively). Service implementations and callers typed against the old base name must switch to the XWritable name.

### Features

* **openapi-server:** single typed input object for Fastify service methods, ctx kept separate ([#350](https://github.com/codewithagents/openapi-zod-ts/issues/350)) ([2e37337](https://github.com/codewithagents/openapi-zod-ts/commit/2e373378dc2b9b7eafd7a90f520a5eec4092f14d))


### Bug Fixes

* **openapi-server:** array-query z.array and multipart $ref body detection in the Fastify emitter ([#348](https://github.com/codewithagents/openapi-zod-ts/issues/348), [#349](https://github.com/codewithagents/openapi-zod-ts/issues/349)) ([d4a9d72](https://github.com/codewithagents/openapi-zod-ts/commit/d4a9d7228d6fd8c06793a4cc72c76af8ba3f67b2))
* **openapi-server:** cast octet-stream result to BodyInit in the Hono router ([#356](https://github.com/codewithagents/openapi-zod-ts/issues/356)) ([8481e5c](https://github.com/codewithagents/openapi-zod-ts/commit/8481e5c4d7165a0430a1ff5278b9bcf3679bb1f0))
* **openapi-server:** lock required-querystring narrowing in the Fastify type-provider emitter ([#344](https://github.com/codewithagents/openapi-zod-ts/issues/344)) ([#345](https://github.com/codewithagents/openapi-zod-ts/issues/345)) ([3267549](https://github.com/codewithagents/openapi-zod-ts/commit/32675494c0a7b07f789fc0215173b156413de8dc))
* **openapi-zod-ts:** derive read/write variants transitively so response types are the read shape ([#365](https://github.com/codewithagents/openapi-zod-ts/issues/365)) ([6337af1](https://github.com/codewithagents/openapi-zod-ts/commit/6337af17d47964e8e90393e594f1a5157d92fe26))


### Performance Improvements

* **ci:** carve the 128-spec compat matrix off the required gate, parallelize coverage ([#352](https://github.com/codewithagents/openapi-zod-ts/issues/352)) ([939ea00](https://github.com/codewithagents/openapi-zod-ts/commit/939ea0025e190c42e45c05f3c298d68adc014a60))

## [2.0.0](https://github.com/codewithagents/openapi-zod-ts/compare/openapi-server-v1.10.0...openapi-server-v2.0.0) (2026-06-21)


### ⚠ BREAKING CHANGES

* **openapi-server:** Fastify auth/context seam + global runtime hooks; opt-in CI drift gate (#335, #336, #337) ([#339](https://github.com/codewithagents/openapi-zod-ts/issues/339))
* **openapi-server:** shared _shared/errors.ts runtime for cross-router HttpError + registerCustomRoutes (#329-#333) ([#338](https://github.com/codewithagents/openapi-zod-ts/issues/338))
* **openapi-server:** generated Fastify service interface and HttpError envelope/module path changed.
* createRouter(service) now returns a FastifyPluginAsyncZod plugin; mount via app.register(createRouter(service), { prefix }) instead of createRouter(instance, service).
* **openapi-server:** the generated Fastify router output is restructured to use fastify-type-provider-zod's native validation pipeline. Request body, query, param, and header validation failures now return Fastify's native 400 (FST_ERR_VALIDATION) instead of the 422 { error, issues } envelope used by the Hono and Express routers (cookie validation still returns 422). Generated imports and route registration shape change, and the package now expects fastify and fastify-type-provider-zod as peer dependencies.

### Features

* native zero-cast Fastify codegen (plugin factory, z.infer types, inline-response synthesis) ([#327](https://github.com/codewithagents/openapi-zod-ts/issues/327)) ([7f533d4](https://github.com/codewithagents/openapi-zod-ts/commit/7f533d49fce7de2b892dec54908a7390b6bb1091))
* **openapi-server:** Fastify auth/context seam + global runtime hooks; opt-in CI drift gate ([#335](https://github.com/codewithagents/openapi-zod-ts/issues/335), [#336](https://github.com/codewithagents/openapi-zod-ts/issues/336), [#337](https://github.com/codewithagents/openapi-zod-ts/issues/337)) ([#339](https://github.com/codewithagents/openapi-zod-ts/issues/339)) ([c4eb03e](https://github.com/codewithagents/openapi-zod-ts/commit/c4eb03e2ff763bc408a6d7ba3f6b5d1fbac91879))
* **openapi-server:** maximally native Fastify codegen ([#328](https://github.com/codewithagents/openapi-zod-ts/issues/328)) ([eb60286](https://github.com/codewithagents/openapi-zod-ts/commit/eb602861022b06f131a9030b93244c5511557818))
* **openapi-server:** replace Fastify router with fastify-type-provider-zod emitter ([dbf4f18](https://github.com/codewithagents/openapi-zod-ts/commit/dbf4f18b01501740b94f20087fcd303a4a832d24))
* **openapi-server:** shared _shared/errors.ts runtime for cross-router HttpError + registerCustomRoutes ([#329](https://github.com/codewithagents/openapi-zod-ts/issues/329)-[#333](https://github.com/codewithagents/openapi-zod-ts/issues/333)) ([#338](https://github.com/codewithagents/openapi-zod-ts/issues/338)) ([120f79f](https://github.com/codewithagents/openapi-zod-ts/commit/120f79ff4ecd1e0900c87c1476d061068d3645d8))


### Bug Fixes

* **openapi-server:** emit Zod 4 top-level format validators for path params ([ea9d0c7](https://github.com/codewithagents/openapi-zod-ts/commit/ea9d0c79e7937b38d31d6eae1d7a6a55718b50cd))
* **openapi-server:** generic createRouter so context_type output typechecks, with Fastify auth runtime test ([#340](https://github.com/codewithagents/openapi-zod-ts/issues/340)) ([6a40843](https://github.com/codewithagents/openapi-zod-ts/commit/6a408437d45ed0a636045f6b48b20730f358a7ef))
* **openapi-server:** guard cookie read so missing @fastify/cookie returns 422 ([ea9d0c7](https://github.com/codewithagents/openapi-zod-ts/commit/ea9d0c79e7937b38d31d6eae1d7a6a55718b50cd))
* **openapi-server:** import ZodTypeProvider as type-only for verbatimModuleSyntax ([#326](https://github.com/codewithagents/openapi-zod-ts/issues/326)) ([ea9d0c7](https://github.com/codewithagents/openapi-zod-ts/commit/ea9d0c79e7937b38d31d6eae1d7a6a55718b50cd))

## [1.10.0](https://github.com/codewithagents/openapi-zod-ts/compare/openapi-server-v1.9.0...openapi-server-v1.10.0) (2026-06-19)


### Features

* **openapi-server:** document Fastify body parsers and generate octet-stream request parser ([#318](https://github.com/codewithagents/openapi-zod-ts/issues/318)) ([d22a191](https://github.com/codewithagents/openapi-zod-ts/commit/d22a191e50a139b420a0e0efed03175f72512b6a))
* **openapi-server:** inject operationId into Fastify route config ([#309](https://github.com/codewithagents/openapi-zod-ts/issues/309)) ([164ffbe](https://github.com/codewithagents/openapi-zod-ts/commit/164ffbe51219779e0191ea1e87c096ff3c1f46cd))
* **openapi-server:** support request-scoped context type for service methods ([#310](https://github.com/codewithagents/openapi-zod-ts/issues/310)) ([24625f6](https://github.com/codewithagents/openapi-zod-ts/commit/24625f6782c0b7052c619d31236f24a2d6192c25))
* **openapi-server:** validate cookie params (in: cookie) across Fastify/Express/Hono ([#319](https://github.com/codewithagents/openapi-zod-ts/issues/319)) ([6c4bdc6](https://github.com/codewithagents/openapi-zod-ts/commit/6c4bdc6fc46da20a452576d072c4c181f1b031fb))
* **openapi-server:** warn on untyped service responses from missing schemas ([#312](https://github.com/codewithagents/openapi-zod-ts/issues/312)) ([6935779](https://github.com/codewithagents/openapi-zod-ts/commit/6935779234bd90559b119ace5977f0ae7296b383))
* **openapi-server:** wire Fastify schema.response for runtime response validation ([#308](https://github.com/codewithagents/openapi-zod-ts/issues/308)) ([b2daf81](https://github.com/codewithagents/openapi-zod-ts/commit/b2daf8180541b86c3da0cb93188830d133c37d5e))


### Bug Fixes

* **openapi-server:** await service call in Fastify JSON response branches so HttpError maps correctly ([#315](https://github.com/codewithagents/openapi-zod-ts/issues/315)) ([d6da1e5](https://github.com/codewithagents/openapi-zod-ts/commit/d6da1e58e97435691e8e5b2d626e6cf4c2375d65))
* **openapi-server:** coerce numeric and boolean query params on Fastify ([#314](https://github.com/codewithagents/openapi-zod-ts/issues/314)) ([346ead8](https://github.com/codewithagents/openapi-zod-ts/commit/346ead8eb0292ee961613dbb4bf11a6940b7fee3))
* **openapi-server:** look up header params by lowercased key on Fastify/Express ([#313](https://github.com/codewithagents/openapi-zod-ts/issues/313)) ([9da0320](https://github.com/codewithagents/openapi-zod-ts/commit/9da03209952e461fc722fe4c82d45941efee4965))
* **openapi-server:** type-check example servers and add Fastify inject suite + CI ([#316](https://github.com/codewithagents/openapi-zod-ts/issues/316)) ([6171e59](https://github.com/codewithagents/openapi-zod-ts/commit/6171e59f9b0ba7932f5a113fd03a8e13d61fba52))
* **openapi-server:** type-check router against its own service interface ([#317](https://github.com/codewithagents/openapi-zod-ts/issues/317)) ([2a6b057](https://github.com/codewithagents/openapi-zod-ts/commit/2a6b057240a15321da24b920472411058909afa7))

## [1.9.0](https://github.com/codewithagents/openapi-zod-ts/compare/openapi-server-v1.8.0...openapi-server-v1.9.0) (2026-06-15)


### Features

* **petstore-hono + openapi-server:** battle-tested e2e contract suite + 14 generator fixes ([#307](https://github.com/codewithagents/openapi-zod-ts/issues/307)) ([405a924](https://github.com/codewithagents/openapi-zod-ts/commit/405a924a0cc9314a034c11f0bb4fd484ba90731a))

## [1.8.0](https://github.com/codewithagents/openapi-zod-ts/compare/openapi-server-v1.7.0...openapi-server-v1.8.0) (2026-06-10)


### Features

* **config:** multi-spec projects array drives N generations from one file ([#238](https://github.com/codewithagents/openapi-zod-ts/issues/238)) ([#288](https://github.com/codewithagents/openapi-zod-ts/issues/288)) ([aab136b](https://github.com/codewithagents/openapi-zod-ts/commit/aab136b6e20972dd51528f55b7ec5aecfc57b34f))

## [1.7.0](https://github.com/codewithagents/openapi-zod-ts/compare/openapi-server-v1.6.0...openapi-server-v1.7.0) (2026-06-03)


### Miscellaneous

* Dependency renamed from `@codewithagents/openapi-gen` to `openapi-zod-ts` (`^1.0.0`). No public API changes. ([#266](https://github.com/codewithagents/openapi-zod-ts/issues/266))

## [1.6.0](https://github.com/codewithagents/openapi-zod-ts/compare/openapi-server-v1.5.0...openapi-server-v1.6.0) (2026-06-02)


### Features

* **cli:** shared cli-core eliminates byte-identical parseCliArgs across packages ([#238](https://github.com/codewithagents/openapi-zod-ts/issues/238)) ([#252](https://github.com/codewithagents/openapi-zod-ts/issues/252)) ([200af1f](https://github.com/codewithagents/openapi-zod-ts/commit/200af1fcb94bb570bc18d79eedfdd3e0125c8d85))

## [1.5.0](https://github.com/codewithagents/openapi-zod-ts/compare/openapi-server-v1.4.0...openapi-server-v1.5.0) (2026-06-01)


### Features

* **config:** shared config-core + JS config support for react-query/server ([#238](https://github.com/codewithagents/openapi-zod-ts/issues/238)) ([#239](https://github.com/codewithagents/openapi-zod-ts/issues/239)) ([b4559a9](https://github.com/codewithagents/openapi-zod-ts/commit/b4559a96bef3396dbd24ddfec0e2799ee93c7d9d))

## [1.4.0](https://github.com/codewithagents/openapi-zod-ts/compare/openapi-server-v1.3.2...openapi-server-v1.4.0) (2026-06-01)


### Features

* **cli:** add --help and --version to all three CLIs ([#178](https://github.com/codewithagents/openapi-zod-ts/issues/178)) ([#203](https://github.com/codewithagents/openapi-zod-ts/issues/203)) ([6f641e0](https://github.com/codewithagents/openapi-zod-ts/commit/6f641e05d3d19c1a4394247c3c079556e8a52274))


### Bug Fixes

* **openapi-server:** validate path/query/header params ([#177](https://github.com/codewithagents/openapi-zod-ts/issues/177)) ([#202](https://github.com/codewithagents/openapi-zod-ts/issues/202)) ([c592234](https://github.com/codewithagents/openapi-zod-ts/commit/c59223487900d3276512ddc3465946148724a03f))

## [1.3.2](https://github.com/codewithagents/openapi-zod-ts/compare/openapi-server-v1.3.1...openapi-server-v1.3.2) (2026-05-31)


### Bug Fixes

* **security:** escape spec-derived strings in generated code ([#169](https://github.com/codewithagents/openapi-zod-ts/issues/169)) ([35f232d](https://github.com/codewithagents/openapi-zod-ts/commit/35f232dbb6b4baaea652a87f44bbd9f4e2f3046c))

## [1.3.1](https://github.com/codewithagents/openapi-zod-ts/compare/openapi-server-v1.3.0...openapi-server-v1.3.1) (2026-05-31)


### Bug Fixes

* add consistent package metadata (homepage, bugs, author) across all packages ([#166](https://github.com/codewithagents/openapi-zod-ts/issues/166)) ([dc2c1d3](https://github.com/codewithagents/openapi-zod-ts/commit/dc2c1d327e87dabbe07450a1664ba6158aff82de))

## [1.3.0](https://github.com/codewithagents/openapi-ts/compare/openapi-server-v1.2.0...openapi-server-v1.3.0) (2026-05-30)


### Features

* **openapi-server:** add Express and Fastify router generation with Zod validation ([a1a9d53](https://github.com/codewithagents/openapi-ts/commit/a1a9d5390ae8584afee183835d0976bae4239d28))


### Bug Fixes

* resolve CodeQL security findings ([1775358](https://github.com/codewithagents/openapi-ts/commit/17753583a2ae32fdd16e45cd476de74119c6a6ba))

## [1.2.0](https://github.com/codewithagents/glue/compare/openapi-server-v1.1.0...openapi-server-v1.2.0) (2026-05-29)


### Features

* **smoke:** expand to 9 real API requests, run on every push to main ([#144](https://github.com/codewithagents/glue/issues/144)) ([ba0c7c3](https://github.com/codewithagents/glue/commit/ba0c7c39c97f4f0a152fed67676346c035de90fd))

## [1.1.0](https://github.com/codewithagents/glue/compare/openapi-server-v1.0.0...openapi-server-v1.1.0) (2026-05-29)


### Features

* examples directory — 11 real-world specs, 7 generator bug fixes ([#137](https://github.com/codewithagents/glue/issues/137)) ([66edd3f](https://github.com/codewithagents/glue/commit/66edd3feacad868ed24058370c910628ccd7dc5a))


### Bug Fixes

* **ci:** isolate codecov uploads + expand compat matrix to all 3 generators ([#140](https://github.com/codewithagents/glue/issues/140)) ([240b79a](https://github.com/codewithagents/glue/commit/240b79a0360d2f89cc08db56e8629c8c068c07a2))
* **coverage:** use lcov projectRoot option to emit repo-relative SF paths ([8cefc4f](https://github.com/codewithagents/glue/commit/8cefc4fa39755c923b97c0938ccec72b3fe3768f))
* generator handles 127/128 real-world specs + docs update ([#139](https://github.com/codewithagents/glue/issues/139)) ([07fcd2a](https://github.com/codewithagents/glue/commit/07fcd2a4c7c9e92b91ea0b3754e9774cf7ff1439))

## [1.0.0](https://github.com/codewithagents/glue/compare/openapi-server-v0.3.0...openapi-server-v1.0.0) (2026-05-27)


### ⚠ BREAKING CHANGES

* generated files are now Prettier-formatted. Re-generate after upgrading if you run prettier --check on committed output.

### Features

* regenerate with Prettier and add vitest unit tests ([#134](https://github.com/codewithagents/glue/issues/134)) ([1d50c89](https://github.com/codewithagents/glue/commit/1d50c8915432464bde64067720691431973bf494))
* YAML/Zod pipeline tests + openapi-server Prettier and 1.0.0 ([#133](https://github.com/codewithagents/glue/issues/133)) ([8ec2f1e](https://github.com/codewithagents/glue/commit/8ec2f1ec17486fc3645939e515cbb401500927f3))

## [0.3.0](https://github.com/codewithagents/glue/compare/openapi-server-v0.2.0...openapi-server-v0.3.0) (2026-05-26)


### Features

* **openapi-server:** Zod request validation via input_schema + YAML spec support ([#102](https://github.com/codewithagents/glue/issues/102)) ([5d9276e](https://github.com/codewithagents/glue/commit/5d9276e55807e68a3ccce7a85b9950bd90242561))


### Bug Fixes

* repair per-package Codecov badges and add openapi-server coverage ([#97](https://github.com/codewithagents/glue/issues/97)) ([72b3b50](https://github.com/codewithagents/glue/commit/72b3b50e6bb0502e21d2ae967ee20f6578fffc86))

## [0.2.0](https://github.com/codewithagents/glue/compare/openapi-server-v0.1.0...openapi-server-v0.2.0) (2026-05-26)


### Features

* add @codewithagents/openapi-server package ([#91](https://github.com/codewithagents/glue/issues/91)) ([44cbe80](https://github.com/codewithagents/glue/commit/44cbe801317f29d22892ec92ef557189c0dbee2b))
