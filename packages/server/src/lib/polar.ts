import { Polar } from "@polar-sh/sdk";

import env from "../env";

const polar = new Polar({
  accessToken: env.POLAR_ACCESS_TOKEN,
  server: env.POLAR_SERVER,
});

/**
 * Where Polar sends the customer's browser once they are done. Deliberately not
 * derived from the incoming request: `c.req.url` is rebuilt from the Host
 * header, so a request forged with `Host: evil.com` would have us ask Polar to
 * bounce a paying customer to `https://evil.com/billing/success`.
 */
const SUCCESS_URL = new URL(
  "/billing/success",
  env.PUBLIC_BASE_URL ?? `http://localhost:${env.PORT}`,
).toString();

function hasStatusCode(error: unknown): error is { statusCode: number } {
  return (
    typeof error === "object" &&
    error !== null &&
    "statusCode" in error &&
    typeof error.statusCode === "number"
  );
}

export async function createCheckoutUrl(customerExternalId: string) {
  const result = await polar.checkouts.create({
    products: [env.POLAR_PRODUCT_ID],
    successUrl: SUCCESS_URL,
    externalCustomerId: customerExternalId,
    metadata: { source: "openchess-cli" },
  });

  return result.url;
}

export async function createCustomerPortalUrl(customerExternalId: string) {
  const result = await polar.customerSessions.create({
    externalCustomerId: customerExternalId,
    returnUrl: SUCCESS_URL,
  });

  return result.customerPortalUrl;
}

/**
 * Whether this customer counts as premium.
 *
 * Premium currently means "holds any active Polar subscription": the premium
 * product does not exist in Polar yet, so there is no product id to pin this
 * to. Once it is created, narrow the check to
 * `sub.productId === env.POLAR_PREMIUM_PRODUCT_ID`.
 *
 * The external id is our own `User.id` — the same id `createCheckoutUrl` is
 * called with, which is what links a checkout back to a player.
 */
export async function hasActiveSubscription(customerExternalId: string) {
  try {
    const customerState = await polar.customers.getStateExternal({
      externalId: customerExternalId,
    });

    return customerState.activeSubscriptions.length > 0;
  } catch (error) {
    // No Polar customer exists until the first checkout; that is simply "not
    // premium", not an error.
    if (hasStatusCode(error) && error.statusCode === 404) {
      return false;
    }

    throw error;
  }
}

export async function getAvailableCreditsBalance(customerExternalId: string) {
  try {
    const customerState = await polar.customers.getStateExternal({
      externalId: customerExternalId,
    });

    const matchingMeters = customerState.activeMeters.filter(
      (meter) => meter.meterId === env.POLAR_CREDITS_METER_ID,
    );

    if (matchingMeters.length > 1) {
      throw new Error("Expected exactly one matching Polar credits meter");
    }

    const creditsMeter = matchingMeters[0];
    return creditsMeter?.balance ?? 0;
  } catch (error) {
    if (hasStatusCode(error) && error.statusCode === 404) {
      return 0;
    }

    throw error;
  }
}
