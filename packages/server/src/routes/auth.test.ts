import { describe, expect, test } from "bun:test";
import * as HttpStatusCodes from "stoker/http-status-codes";

import app from "../app";
import { PROBLEM_JSON_MEDIA_TYPE } from "../lib/problem-details";
import { portFromState } from "./auth";

/** Mint a `state` the way the CLI does: base64url payload, dot, nonce. */
function encodeState(payload: unknown, nonce = "nonce") {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");

  return `${encoded}.${nonce}`;
}

function callback(query: Record<string, string>) {
  const params = new URLSearchParams(query);

  return app.request(`/api/auth/callback?${params}`);
}

describe("portFromState", () => {
  test("recovers the port from a well-formed state", () => {
    expect(portFromState(encodeState({ port: 51234 }))).toBe(51234);
  });

  test("ignores unknown keys rather than carrying them forward", () => {
    expect(portFromState(encodeState({ port: 51234, host: "evil.com" }))).toBe(
      51234,
    );
  });

  test.each([
    ["a privileged port", { port: 80 }],
    ["a port above the 16-bit range", { port: 70000 }],
    ["a negative port", { port: -1 }],
    ["a non-integer port", { port: 8080.5 }],
    ["a port smuggled as a string", { port: "8080" }],
    ["a port that would splice a host into the URL", { port: "80@evil.com" }],
    ["a missing port", { nonce: "abc" }],
    ["a null port", { port: null }],
    ["a payload that isn't an object", 8080],
  ])("rejects %s", (_label, payload) => {
    expect(portFromState(encodeState(payload))).toBeNull();
  });

  test("rejects a state that isn't valid base64url JSON", () => {
    expect(portFromState("not-base64.nonce")).toBeNull();
  });

  test("rejects an empty state", () => {
    expect(portFromState("")).toBeNull();
  });

  test("rejects an oversized state without parsing it", () => {
    const huge = encodeState({ port: 51234, pad: "x".repeat(1024) });

    expect(huge.length).toBeGreaterThan(512);
    expect(portFromState(huge)).toBeNull();
  });

  test("does not let a __proto__ key in the payload pollute Object", () => {
    const state = encodeState(
      JSON.parse('{"port":51234,"__proto__":{"polluted":true}}'),
    );

    expect(portFromState(state)).toBe(51234);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe("GET /auth/callback", () => {
  test("bounces a valid callback to the CLI's loopback port", async () => {
    const state = encodeState({ port: 51234 });
    const response = await callback({ code: "auth-code", state });

    expect(response.status).toBe(HttpStatusCodes.MOVED_TEMPORARILY);

    const location = new URL(response.headers.get("location")!);

    expect(location.protocol).toBe("http:");
    expect(location.hostname).toBe("127.0.0.1");
    expect(location.port).toBe("51234");
    expect(location.pathname).toBe("/callback");
    expect(location.searchParams.get("code")).toBe("auth-code");
    expect(location.searchParams.get("state")).toBe(state);
  });

  test("percent-encodes a code that would otherwise inject query params", async () => {
    const response = await callback({
      code: "abc&admin=true",
      state: encodeState({ port: 51234 }),
    });

    const location = new URL(response.headers.get("location")!);

    expect(location.searchParams.get("code")).toBe("abc&admin=true");
    expect(location.searchParams.get("admin")).toBeNull();
  });

  test("refuses to redirect anywhere but loopback", async () => {
    const response = await callback({
      code: "auth-code",
      state: encodeState({ port: 80 }),
    });

    expect(response.status).toBe(HttpStatusCodes.BAD_REQUEST);
    expect(response.headers.get("location")).toBeNull();
  });

  test("rejects a callback with no code", async () => {
    const response = await callback({ state: encodeState({ port: 51234 }) });

    expect(response.status).toBe(HttpStatusCodes.BAD_REQUEST);
  });

  test("rejects a callback with no state", async () => {
    const response = await callback({ code: "auth-code" });

    expect(response.status).toBe(HttpStatusCodes.BAD_REQUEST);
  });

  test("answers errors as problem+json, like the rest of the API", async () => {
    const response = await callback({ error: "access_denied" });

    expect(response.status).toBe(HttpStatusCodes.BAD_REQUEST);
    expect(response.headers.get("content-type")).toBe(PROBLEM_JSON_MEDIA_TYPE);
    expect(await response.json()).toMatchObject({
      status: HttpStatusCodes.BAD_REQUEST,
      instance: "/api/auth/callback",
    });
  });

  test("never reflects the caller's error_description back at them", async () => {
    const description = "Your account is locked, call 1-800-555-0100";
    const response = await callback({
      error: "access_denied",
      error_description: description,
    });

    const body = await response.text();

    expect(body).not.toContain(description);
    expect(body).toContain("access_denied");
  });

  test("normalizes an error code outside the OAuth vocabulary", async () => {
    const response = await callback({ error: "<script>alert(1)</script>" });
    const body = await response.text();

    expect(body).not.toContain("script");
    expect(body).toContain("invalid_request");
  });
});
