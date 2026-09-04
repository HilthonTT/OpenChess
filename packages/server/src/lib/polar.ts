import { Polar } from "@polar-sh/sdk";

import env from "../env";

const polar = new Polar({
  accessToken: env.POLAR_ACCESS_TOKEN,
  server: env.POLAR_SERVER,
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

export async function hasActiveSubscription(customerExternalId: string) {
  try {
    const customerState = await polar.customers.getStateExternal({
      externalId: customerExternalId,
    });

    return customerState.activeSubscriptions.length > 0;
  } catch (error) {
    if (hasStatusCode(error) && error.statusCode === 404) {
      return false;
    }

    throw error;
  }
}

export async function listActiveSubscriberExternalIds(): Promise<string[]> {
  const ids = new Set<string>();

  const pages = await polar.subscriptions.list({ active: true, limit: 100 });

  for await (const page of pages) {
    for (const subscription of page.result.items) {
      const externalId = subscription.customer.externalId;
      if (externalId) {
        ids.add(externalId);
      }
    }
  }

  return [...ids];
}
