import { afterEach, describe, expect, it } from "vitest";
import { startHttpServer } from "../src/http.js";

const closers: Array<() => Promise<void>> = [];
afterEach(async () => Promise.allSettled(closers.splice(0).map((close) => close())));

describe("HTTP runtime", () => {
  it("serves a loopback health endpoint", async () => {
    const runtime = await startHttpServer({ host: "127.0.0.1", port: 0, publicBaseUrl: "http://127.0.0.1" });
    closers.push(runtime.close);
    const address = runtime.server.address();
    if (!address || typeof address === "string") throw new Error("Expected TCP address");
    const response = await fetch(`http://127.0.0.1:${address.port}/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(expect.objectContaining({ status: "ok", mode: "SYNTHETIC_DEMO" }));
  });

  it("refuses an accidental public bind", async () => {
    await expect(startHttpServer({ host: "0.0.0.0", port: 0, publicBaseUrl: "http://localhost" }))
      .rejects.toThrow(/Refusing a non-loopback demo bind/);
  });
});
