import { createPolar } from "@polar-sh/sdk/2026-10";

import env from "../env";

const polar = createPolar({
  accessToken: env.POLAR_ACCESS_TOKEN,
  environment: env.POLAR_SERVER,
});

const SUCCESS_URL = new URL(
  "/api/billing/success",
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
    success_url: SUCCESS_URL,
    external_customer_id: customerExternalId,
    metadata: { source: "openchess-cli" },
  });

  return result.url;
}

export async function createCustomerPortalUrl(customerExternalId: string) {
  const result = await polar.customerSessions.create({
    external_customer_id: customerExternalId,
    return_url: SUCCESS_URL,
  });

  return result.customer_portal_url;
}

export async function hasActiveSubscription(customerExternalId: string) {
  try {
    const customerState =
      await polar.customers.getStateExternal(customerExternalId);

    return customerState.active_subscriptions.length > 0;
  } catch (error) {
    if (hasStatusCode(error) && error.statusCode === 404) {
      return false;
    }

    throw error;
  }
}

export async function listActiveSubscriberExternalIds(): Promise<string[]> {
  const ids = new Set<string>();

  for await (const subscription of polar.subscriptions.iterList({
    active: true,
    limit: 100,
  })) {
    const externalId = subscription.customer.external_id;
    if (externalId) {
      ids.add(externalId);
    }
  }

  return [...ids];
}
