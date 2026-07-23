import open from "open";
import { apiClient } from "./api-client";
import { responseError } from "./http-errors";

/**
 * Launch a server-supplied URL in the browser — but only a web URL. The
 * response is data, not code: opened verbatim, a compromised or spoofed
 * server could hand the OS any protocol handler (`file:`, custom schemes).
 * Restricting to http(s) keeps the blast radius at "opens a web page".
 */
async function openWebUrl(url: string) {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("The server sent an invalid link.");
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("The server sent a link that isn't a web page.");
  }

  await open(parsed.toString());
}

export async function fetchPremiumStatus(): Promise<boolean> {
  const response = await apiClient.billing.status.$get();

  if (response.ok) {
    const data = await response.json();
    return data.premium;
  }

  throw await responseError(response);
}

export async function openUpgradeCheckout() {
  const response = await apiClient.billing.checkout.$post();

  if (response.ok) {
    const data = await response.json();
    await openWebUrl(data.url);
    return;
  }

  throw await responseError(response);
}

export async function openBillingPortal() {
  const response = await apiClient.billing.portal.$post();

  if (response.ok) {
    const data = await response.json();
    await openWebUrl(data.url);
    return;
  }

  throw await responseError(response);
}
