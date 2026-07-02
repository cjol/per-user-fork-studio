import { getAgentByName } from "agents";
import type { ResolvedForkableConfig } from "./config.js";
import type { UserAppStub } from "./types.js";

/**
 * Look up a UserApp Durable Object by name through the configured binding.
 * Typed loosely because the host worker's Env is only known to the consumer.
 */
export async function userAppByName(
  env: Cloudflare.Env,
  cfg: ResolvedForkableConfig,
  name: string
): Promise<UserAppStub> {
  const ns = (env as Record<string, unknown>)[cfg.bindings.userApp];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stub = await getAgentByName(ns as any, name);
  return stub as unknown as UserAppStub;
}
