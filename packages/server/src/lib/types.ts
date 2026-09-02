import type { OpenAPIHono, RouteConfig, RouteHandler } from "@hono/zod-openapi";
import type { Schema } from "hono";
import type { RequestIdVariables } from "hono/request-id";
import type { PinoLogger } from "hono-pino";

export interface AppBindings {
  Variables: RequestIdVariables & {
    logger: PinoLogger;
  };
}

export type AppOpenAPI<S extends Schema = {}> = OpenAPIHono<AppBindings, S>;

export type AppRouteHandler<R extends RouteConfig> = RouteHandler<
  R,
  AppBindings
>;
