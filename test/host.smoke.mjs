/**
 * chicheng-vault — host half smoke test.
 * Mounts apply() with stub services, exercises the /vault/api routes through a
 * fake HTTP request/response pair, and verifies the session watcher queues
 * suggestions and that ack/clear work. Runs against a throwaway DSH_HOME.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.DSH_HOME = await mkdtemp(join(tmpdir(), "chicheng-vault-test-"));
const { apply, _internals: I } = await import("../lib/index.js");

let failures = 0;
function assert(name, cond, extra) {
  if (cond) console.log("  ok  " + name);
  else { failures += 1; console.log("FAIL  " + name + (extra ? " :: " + extra : "")); }
}

// ---- stub services mirroring the web profile composition
const registered = [];
const emitted = [];
const ctx = {
  webServer: {
    register(spec) {
      registered.push(spec);
      return () => {};
    },
    port: 3080,
  },
  webRuntime: { trustedHosts: [] },
  logger: { info() {}, warn() {}, error() {} },
  get() { return null; },
  effect(fn, label) {
    const dispose = fn();
    if (typeof dispose === "function") ctx._disposers.push(dispose);
  },
  on(event, listener) {
    emitted.push({ event, listener });
    return () => {};
  },
  _disposers: [],
};

// simulate loopback HTTP request through the registered prefix handler
async function callApi(method, payload) {
  const spec = registered.find((r) => r.path === "/vault/api");
  if (!spec) throw new Error("route not registered");
  const reqUrl = `/vault/api/${method}`;
  const req = new ReadableStreamRequest(reqUrl, JSON.stringify(payload ?? {}));
  const res = new FakeResponse();
  await spec.handler(req, res);
  let parsed = {};
  try { parsed = JSON.parse(res.body); } catch { parsed = {}; }
  return { status: res.status, ok: parsed.ok === true, value: parsed.value, error: parsed.error, body: parsed };
}

class ReadableStreamRequest {
  constructor(url, bodyText) {
    this.url = url;
    this.method = "POST";
    this.headers = { host: "127.0.0.1:3080", "sec-fetch-site": "same-origin" };
    this._body = bodyText;
    this._idx = 0;
  }
  async *[Symbol.asyncIterator]() {
    if (this._body) yield Buffer.from(this._body, "utf8");
  }
}

class FakeResponse {
  constructor() { this.status = 200; this.headers = {}; this.body = ""; }
  writeHead(status, headers) { this.status = status; this.headers = headers || {}; }
  end(payload) { this.body = payload; }
}

// ---- run
await apply(ctx, {});

assert("route registered", registered.some((r) => r.path === "/vault/api"));
assert("session watcher attached", emitted.some((e) => e.event === "session/event"));

// status: fresh install → not setup
const st = await callApi("status");
assert("status ok", st.ok && st.value.setup === false && st.value.autoDetect === true, JSON.stringify(st.body));

// store roundtrip (v2 字段：version 保留、records/autoLockMinutes 往返)
const storePayload = {
  version: 2,
  setup: true,
  wrapPw: { salt: "a", iv: "b", ct: "c" },
  wrapSec: null,
  vault: { iv: "d", ct: "e" },
  records: [
    { id: "r1", name: "n", category: "其他", tags: [], createdAt: "t", updatedAt: "t", private: false, content: "plain" },
    { id: "r2", name: "p", category: "密钥", tags: [], createdAt: "t", updatedAt: "t", private: true, content: null, enc: { iv: "i", ct: "c" } },
  ],
  autoDetect: true,
  autoLockMinutes: 15,
  meta: { createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
};
const saved = await callApi("saveStore", { store: storePayload });
assert("store saved", saved.ok === true, JSON.stringify(saved.body));
const loaded = await callApi("loadStore");
assert("store loaded back", loaded.ok && loaded.value.wrapPw.ct === "c" && loaded.value.vault.ct === "e", JSON.stringify(loaded.body));
assert("version preserved", loaded.ok && loaded.value.version === 2, JSON.stringify(loaded.body));
assert("records roundtrip", loaded.ok && loaded.value.records.length === 2 && loaded.value.records[0].content === "plain", JSON.stringify(loaded.body));
assert("autoLockMinutes roundtrip", loaded.ok && loaded.value.autoLockMinutes === 15, JSON.stringify(loaded.body));

// 合并保护：局部保存（只改 autoDetect）不得清掉已有 vault/records/wrapPw
await callApi("saveConfig", { autoDetect: false });
const loaded2 = await callApi("loadStore");
assert("partial save keeps vault", loaded2.ok && loaded2.value.vault && loaded2.value.vault.ct === "e", JSON.stringify(loaded2.body));
assert("partial save keeps records", loaded2.ok && loaded2.value.records.length === 2, JSON.stringify(loaded2.body));
assert("partial save keeps wrapPw", loaded2.ok && loaded2.value.wrapPw.ct === "c", JSON.stringify(loaded2.body));
assert("partial save toggles autoDetect", loaded2.ok && loaded2.value.autoDetect === false, JSON.stringify(loaded2.body));
// 恢复开关，避免影响后续 watcher 测试
await callApi("saveConfig", { autoDetect: true });

// watcher: feed a message with a key → suggestion queued
const watcher = emitted.find((e) => e.event === "session/event").listener;
watcher({ id: "sess-1" }, {
  type: "user/message",
  data: { content: [{ kind: "text", text: "sk-0123456789abcdef0123456789abcdef" }] },
});
await new Promise((r) => setTimeout(r, 50));
const sug = await callApi("suggestions");
assert("suggestion queued", sug.ok && sug.value.items.length === 1, JSON.stringify(sug.body));
assert("suggestion is a private key", sug.ok && sug.value.items[0].private === true && sug.value.items[0].category === "密钥", JSON.stringify(sug.body));

// dedupe: same key again → no new suggestion
watcher({ id: "sess-1" }, {
  type: "user/message",
  data: { content: [{ kind: "text", text: "sk-0123456789abcdef0123456789abcdef" }] },
});
await new Promise((r) => setTimeout(r, 50));
const sug2 = await callApi("suggestions");
assert("duplicate suggestion deduped", sug2.ok && sug2.value.items.length === 1, JSON.stringify(sug2.body));

// autoDetect off → no queueing
await callApi("saveConfig", { autoDetect: false });
watcher({ id: "sess-1" }, {
  type: "assistant/message",
  data: { message: { content: [{ kind: "text", text: "http://off.example.com/x" }] } },
});
await new Promise((r) => setTimeout(r, 50));
const sug3 = await callApi("suggestions");
assert("no suggestions while disabled", sug3.ok && sug3.value.items.length === 1, JSON.stringify(sug3.body));
await callApi("saveConfig", { autoDetect: true });

// ack ignore → pending cleared and permanently seen
const itemId = sug2.value.items[0].id;
const acked = await callApi("suggestAck", { ids: [itemId], ignore: true });
assert("ack removed item", acked.ok && acked.value.removed === 1 && acked.value.pendingCount === 0, JSON.stringify(acked.body));
watcher({ id: "sess-1" }, {
  type: "user/message",
  data: { content: [{ kind: "text", text: "sk-0123456789abcdef0123456789abcdef" }] },
});
await new Promise((r) => setTimeout(r, 50));
const sug4 = await callApi("suggestions");
assert("ignored item never re-suggested", sug4.ok && sug4.value.items.length === 0, JSON.stringify(sug4.body));

// webdav proxy (stub global fetch)
let upstreamSeen = null;
globalThis.fetch = async (url, opts) => {
  upstreamSeen = { url: String(url), method: opts.method, body: opts.body, auth: opts.headers.authorization };
  return new Response("ok-body", { status: 207, statusText: "Multi-Status" });
};
const wd = await callApi("webdav", { url: "https://dav.example.com/dav/backup.json", method: "PUT", body: "xyz", username: "u", password: "p" });
assert("webdav proxied", wd.ok && wd.value.status === 207 && wd.value.body === "ok-body", JSON.stringify(wd.body));
assert("webdav upstream args", upstreamSeen !== null && upstreamSeen.url === "https://dav.example.com/dav/backup.json" && upstreamSeen.method === "PUT" && upstreamSeen.body === "xyz" && upstreamSeen.auth === "Basic " + Buffer.from("u:p").toString("base64"), JSON.stringify(upstreamSeen));

// fence: cross-site request denied
{
  const spec = registered.find((r) => r.path === "/vault/api");
  const req = new ReadableStreamRequest("/vault/api/status", "{}");
  req.headers = { host: "evil.example.com", "sec-fetch-site": "cross-site" };
  const res = new FakeResponse();
  await spec.handler(req, res);
  assert("cross-site request fenced", res.status === 403, "status " + res.status);
}

// cleanup
for (const dispose of ctx._disposers) { try { dispose(); } catch {} }
await new Promise((r) => setTimeout(r, 200));
await rm(process.env.DSH_HOME, { recursive: true, force: true });

console.log(failures === 0 ? "\nAll smoke tests passed." : `\n${failures} failure(s).`);
process.exit(failures === 0 ? 0 : 1);
