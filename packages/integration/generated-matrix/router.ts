// This file is auto-generated. Do not edit manually.
// @fastify/formbody and @fastify/multipart are auto-registered inside the plugin for the content types your spec uses.
// Pass multipart.limits in CreateRouterOptions to raise upload-size caps, or registerParsers: false to opt out entirely.

import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import type {
  FastifyRequest,
  FastifyReply,
  onRequestHookHandler,
  preHandlerHookHandler,
  onSendHookHandler,
  onErrorHookHandler,
} from 'fastify'
import type { MatrixCoverageSpecService } from './service.js'
import { z } from 'zod'
import {
  MxAllOfRefsSchema,
  MxAllOfWithSiblingPropsSchema,
  MxAllPrimitivesContainerSchema,
  MxAnyOfRefsSchema,
  MxAnyOfWithNullSchema,
  MxArraysContainerSchema,
  MxCompositionContainerSchema,
  MxCycleCompASchema,
  MxCycleCompBSchema,
  MxCyclicContainerSchema,
  MxEnumConstContainerSchema,
  MxFormatsContainerSchema,
  MxIntegerEnumSchema,
  MxMultiTypeContainerSchema,
  MxMutualASchema,
  MxMutualBSchema,
  MxNullableContainerSchema,
  MxObjectsContainerSchema,
  MxOneOfDiscriminatorSchema,
  MxOneOfRefsSchema,
  MxRecordSchema,
  MxStringSchema,
  MxTreeNodeSchema,
  MxTupleSchema,
  MxTupleWithRestSchema,
} from './schemas.js'

declare module 'fastify' {
  interface FastifyContextConfig {
    operationId?: string
    security?: Array<{ scheme: string; scopes: string[] }>
  }
}

import { HttpError } from './_shared/errors.js'
export { HttpError } from './_shared/errors.js'

export interface CreateRouterOptions {
  errorHandler?: (err: Error, req: FastifyRequest, reply: FastifyReply) => void
  validatorCompiler?: typeof validatorCompiler
  serializerCompiler?: typeof serializerCompiler
  /** Set to false to skip automatic parser registration (default: true). */
  registerParsers?: boolean
  /**
   * Register additional routes on the Fastify instance after the ZodTypeProvider
   * compilers, error handler, and body parsers are set up. Custom routes registered
   * here inherit the ZodTypeProvider context and the HttpError error handler.
   */
  registerCustomRoutes?: (app: import('fastify').FastifyInstance) => void | Promise<void>
  /**
   * Lifecycle hooks registered via app.addHook inside the plugin scope.
   * Hooks are plugin-scoped: they apply to all generated routes and any routes
   * added via registerCustomRoutes, but NOT to the parent Fastify instance.
   *
   * Hook execution order per request:
   *   onRequest -> preHandler -> route handler -> onSend
   *
   * onError fires when a route handler or hook throws; it is an observability hook.
   * The errorHandler (setErrorHandler) is the single response-producer and coexists
   * with onError hooks: both fire, but only errorHandler writes the response.
   *
   * Pass a single handler or an array of handlers; both are accepted.
   */
  onRequest?: onRequestHookHandler | onRequestHookHandler[]
  preHandler?: preHandlerHookHandler | preHandlerHookHandler[]
  onSend?: onSendHookHandler | onSendHookHandler[]
  onError?: onErrorHookHandler | onErrorHookHandler[]
}

export function createRouter(
  service: MatrixCoverageSpecService,
  options?: CreateRouterOptions
): FastifyPluginAsyncZod {
  return async (app) => {
    app.setValidatorCompiler(options?.validatorCompiler ?? validatorCompiler)
    app.setSerializerCompiler(options?.serializerCompiler ?? serializerCompiler)
    if (options?.errorHandler !== undefined) {
      app.setErrorHandler(options.errorHandler)
    } else {
      const _HTTP_CODES: Record<number, string> = {
        400: 'BAD_REQUEST',
        401: 'UNAUTHORIZED',
        403: 'FORBIDDEN',
        404: 'NOT_FOUND',
        409: 'CONFLICT',
        410: 'GONE',
        422: 'UNPROCESSABLE_ENTITY',
        429: 'TOO_MANY_REQUESTS',
        500: 'INTERNAL_ERROR',
      }
      app.setErrorHandler((err, _req, reply) => {
        if (err instanceof HttpError) {
          const _errCode = _HTTP_CODES[err.status] ?? 'APP_ERROR'
          const _errReply = reply.status(err.status)
          return _errReply.send({
            statusCode: err.status,
            code: _errCode,
            error: err.message,
            message: err.message,
          })
        }
        throw err
      })
    }
    const _asHookArray = <T>(v: T | T[] | undefined): T[] =>
      v === undefined ? [] : Array.isArray(v) ? v : [v]
    for (const _h of _asHookArray(options?.onRequest)) app.addHook('onRequest', _h)
    for (const _h of _asHookArray(options?.preHandler)) app.addHook('preHandler', _h)
    for (const _h of _asHookArray(options?.onSend)) app.addHook('onSend', _h)
    for (const _h of _asHookArray(options?.onError)) app.addHook('onError', _h)
    if (options?.registerCustomRoutes !== undefined) {
      await options.registerCustomRoutes(app)
    }

    app.get(
      '/matrix/primitives',
      {
        schema: {
          querystring: z.object({
            strParam: z.string().optional(),
            emailParam: z.string().optional(),
            uuidParam: z.string().optional(),
            dateParam: z.string().optional(),
            intParam: z.coerce.number().optional(),
            int32Param: z.coerce.number().optional(),
            numParam: z.coerce.number().optional(),
            boolParam: z
              .enum(['true', 'false'])
              .transform((v) => v === 'true')
              .optional(),
          }),
          response: { 200: MxAllPrimitivesContainerSchema },
        },
        config: { operationId: 'getPrimitiveEcho' },
      },
      async (req, reply) => {
        return reply.send(await service.getPrimitiveEcho({ query: req.query }))
      }
    )

    app.get(
      '/matrix/primitives/:id/:code',
      {
        schema: {
          params: z.object({ id: z.uuid(), code: z.string() }),
          response: { 200: MxFormatsContainerSchema },
        },
        config: { operationId: 'getPrimitiveByPath' },
      },
      async (req, reply) => {
        return reply.send(await service.getPrimitiveByPath({ params: req.params }))
      }
    )

    app.get(
      '/matrix/enums',
      {
        schema: {
          querystring: z.object({ strEnum: z.string().optional(), intEnum: z.string().optional() }),
          response: { 200: MxEnumConstContainerSchema },
        },
        config: { operationId: 'getEnumEcho' },
      },
      async (req, reply) => {
        return reply.send(await service.getEnumEcho({ query: req.query }))
      }
    )

    app.get(
      '/matrix/enums/:pathEnum',
      {
        schema: {
          params: z.object({ pathEnum: z.string() }),
          response: { 200: MxIntegerEnumSchema },
        },
        config: { operationId: 'getEnumByPath' },
      },
      async (req, reply) => {
        return reply.send(await service.getEnumByPath({ params: req.params }))
      }
    )

    app.post(
      '/matrix/arrays',
      {
        schema: { body: MxArraysContainerSchema, response: { 200: MxArraysContainerSchema } },
        config: { operationId: 'postArrays' },
      },
      async (req, reply) => {
        return reply.send(await service.postArrays({ body: req.body }))
      }
    )

    app.post(
      '/matrix/objects',
      {
        schema: { body: MxObjectsContainerSchema, response: { 200: MxObjectsContainerSchema } },
        config: { operationId: 'postObjects' },
      },
      async (req, reply) => {
        return reply.send(await service.postObjects({ body: req.body }))
      }
    )

    app.post(
      '/matrix/nullable',
      {
        schema: { body: MxNullableContainerSchema, response: { 200: MxNullableContainerSchema } },
        config: { operationId: 'postNullable' },
      },
      async (req, reply) => {
        return reply.send(await service.postNullable({ body: req.body }))
      }
    )

    app.post(
      '/matrix/composition',
      {
        schema: {
          body: MxCompositionContainerSchema,
          response: { 200: MxCompositionContainerSchema },
        },
        config: { operationId: 'postComposition' },
      },
      async (req, reply) => {
        return reply.send(await service.postComposition({ body: req.body }))
      }
    )

    app.post(
      '/matrix/cyclic',
      {
        schema: { body: MxCyclicContainerSchema, response: { 200: MxCyclicContainerSchema } },
        config: { operationId: 'postCyclic' },
      },
      async (req, reply) => {
        return reply.send(await service.postCyclic({ body: req.body }))
      }
    )

    app.post(
      '/matrix/multitypes',
      {
        schema: { body: MxMultiTypeContainerSchema, response: { 200: MxMultiTypeContainerSchema } },
        config: { operationId: 'postMultiTypes' },
      },
      async (req, reply) => {
        return reply.send(await service.postMultiTypes({ body: req.body }))
      }
    )

    app.get(
      '/matrix/primitives-direct',
      {
        schema: { response: { 200: MxStringSchema } },
        config: { operationId: 'getPrimitiveDirect' },
      },
      async (req, reply) => {
        return reply.send(await service.getPrimitiveDirect())
      }
    )

    app.post(
      '/matrix/record-direct',
      {
        schema: { body: MxRecordSchema, response: { 200: MxRecordSchema } },
        config: { operationId: 'postRecordDirect' },
      },
      async (req, reply) => {
        return reply.send(await service.postRecordDirect({ body: req.body }))
      }
    )

    app.post(
      '/matrix/allof-direct',
      {
        schema: { body: MxAllOfRefsSchema, response: { 200: MxAllOfWithSiblingPropsSchema } },
        config: { operationId: 'postAllOfDirect' },
      },
      async (req, reply) => {
        return reply.send(await service.postAllOfDirect({ body: req.body }))
      }
    )

    app.post(
      '/matrix/anyof-direct',
      {
        schema: { body: MxAnyOfRefsSchema, response: { 200: MxAnyOfWithNullSchema } },
        config: { operationId: 'postAnyOfDirect' },
      },
      async (req, reply) => {
        return reply.send(await service.postAnyOfDirect({ body: req.body }))
      }
    )

    app.post(
      '/matrix/oneof-direct',
      {
        schema: { body: MxOneOfRefsSchema, response: { 200: MxOneOfDiscriminatorSchema } },
        config: { operationId: 'postOneOfDirect' },
      },
      async (req, reply) => {
        return reply.send(await service.postOneOfDirect({ body: req.body }))
      }
    )

    app.post(
      '/matrix/self-recursive',
      {
        schema: { body: MxTreeNodeSchema, response: { 200: MxTreeNodeSchema } },
        config: { operationId: 'postSelfRecursive' },
      },
      async (req, reply) => {
        return reply.send(await service.postSelfRecursive({ body: req.body }))
      }
    )

    app.post(
      '/matrix/mutual-cycle',
      {
        schema: { body: MxMutualASchema, response: { 200: MxMutualBSchema } },
        config: { operationId: 'postMutualCycle' },
      },
      async (req, reply) => {
        return reply.send(await service.postMutualCycle({ body: req.body }))
      }
    )

    app.post(
      '/matrix/cycle-composition',
      {
        schema: { body: MxCycleCompASchema, response: { 200: MxCycleCompBSchema } },
        config: { operationId: 'postCycleComposition' },
      },
      async (req, reply) => {
        return reply.send(await service.postCycleComposition({ body: req.body }))
      }
    )

    app.post(
      '/matrix/tuple-direct',
      {
        schema: { body: MxTupleSchema, response: { 200: MxTupleWithRestSchema } },
        config: { operationId: 'postTupleDirect' },
      },
      async (req, reply) => {
        return reply.send(await service.postTupleDirect({ body: req.body }))
      }
    )
  }
}
