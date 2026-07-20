import open from "open";
import { apiClient } from "./api-client";
import { getProblemDetails } from "./http-errors";

export async function fetchPremiumStatus(): Promise<boolean> {
  const response = await apiClient.billing.status.$get();

  if (response.ok) {
    const data = await response.json();
    return data.premium;
  }

  const problemDetails = await getProblemDetails(response);

  throw new Error(problemDetails.detail ?? problemDetails.title);
}

export async function openUpgradeCheckout() {
  const response = await apiClient.billing.checkout.$post();

  if (response.ok) {
    const data = await response.json();
    await open(data.url);
    return;
  }

  const problemDetails = await getProblemDetails(response);

  throw new Error(problemDetails.detail ?? problemDetails.title);
}

export async function openBillingPortal() {
  const response = await apiClient.billing.portal.$post();

  if (response.ok) {
    const data = await response.json();
    await open(data.url);
    return;
  }

  const problemDetails = await getProblemDetails(response);

  throw new Error(problemDetails.detail ?? problemDetails.title);
}
