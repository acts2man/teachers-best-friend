import assert from "node:assert/strict";
import test from "node:test";

// This is the only test that exercises the second build target: the app is
// also built for Cloudflare Workers through vinext, by a different toolchain
// from the Netlify build everything else runs on. It proves that worker boots
// and serves a page -- worth keeping, and worth keeping honest.
test("the worker build boots and serves the page", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  const response = await worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );

  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("content-type") ?? "",
    /^text\/html\b/i,
  );
  const html = await response.text();
  // It used to assert a <meta name="codex-preview"> tag. Nothing in this app
  // has ever emitted one -- the string existed only in this file -- so the test
  // was red from the day it was imported, and "two failures are expected"
  // became a line in CLAUDE.md. A permanently red suite is how the third
  // failure, the real one, gets ignored. Assert what the page is instead.
  assert.match(html, /<html[^>]*lang=["']en["']/i);
  assert.match(html, /A Teacher.s Best Friend/i);
});
