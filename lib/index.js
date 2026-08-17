/**
 * chicheng-vault — host half
 *
 * 便捷输入保险箱（客户端半在 lib/client.js）：
 *  - 监听全部会话的 user/assistant/tool 消息，自动识别密钥、网址、服务器、
 *    手机号、IP、地址等敏感信息，去重后进入「待收录」队列，供客户端面板
 *    提醒用户是否存入保险箱；
 *  - 持久化客户端加密后的 store（密钥包装 + 保险箱密文），宿主端不落任何
 *    明文敏感数据（仅保存去重用的内容哈希）；
 *  - 提供受信任来源围栏的 JSON API（/vault/api/*）与 WebDAV 备份代理
 *    （转发 PUT/GET/MKCOL，规避浏览器 CORS 限制）。
 *
 * 运行时仅依赖 Node 内置模块 + profile 组合提供的服务，零第三方运行时依赖。
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

// ---------------------------------------------------------------- identity

const name = "chicheng-vault";
const inject = ["webServer", "webRuntime"];

// ---------------------------------------------------------------- paths

const DATA_ROOT = process.env.DSH_HOME
  ? join(process.env.DSH_HOME, "vault")
  : join(homedir(), ".dsh", "vault");
const STORE_PATH = join(DATA_ROOT, "store.json");
const SUGGESTIONS_PATH = join(DATA_ROOT, "suggestions.json");

const STORE_VERSION = 1;
const MAX_PENDING = 40;
const MAX_MATCHES_PER_MESSAGE = 20;

// ---------------------------------------------------------------- store normalize
//
// store 的 schema 由客户端完全掌控（版本、records、加密字段均为客户端产物），
// 宿主只负责原样持久化。normalizeStore 仅在字段缺失/非法时填默认值，并对
// saveStore 做「合并」：局部保存不会清掉已有的 vault/records 等字段
// （历史 bug：白名单重建曾把记录与 vault 一并丢弃）。

function normalizeStore(raw, prev) {
  const prior = prev ?? {};
  const num = (v, d) => (Number.isFinite(v) ? v : d);
  return {
    version: Number.isInteger(raw?.version) ? raw.version : STORE_VERSION,
    setup: raw?.setup === true,
    wrapPw: raw?.wrapPw ?? prior.wrapPw ?? null,
    wrapSec: raw?.wrapSec ?? prior.wrapSec ?? null,
    vault: raw?.vault ?? prior.vault ?? null,
    records: Array.isArray(raw?.records) ? raw.records : (Array.isArray(prior.records) ? prior.records : []),
    autoDetect: raw?.autoDetect !== undefined ? raw.autoDetect !== false : prior.autoDetect !== false,
    autoLockMinutes: num(raw?.autoLockMinutes, num(prior?.autoLockMinutes, 10)),
    meta: raw?.meta ?? prior.meta ?? null,
  };
}

// ---------------------------------------------------------------- matchers
//
// 识别顺序即优先级：密钥(含 JWT/PEM) → 网址 → SSH 服务器 → 手机号(仅中国大陆) →
// IP → 地址。低优先级的命中若落在更高优先级已接受的区间内会被丢弃，避免
// 「ssh://user@1.2.3.4」同时被服务器与 IP 规则重复收录。

const KEY_PATTERNS = [
  // PEM 私钥块
  /-----BEGIN (?:RSA |EC |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY-----[\s\S]{20,}?-----END (?:RSA |EC |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY-----/g,
  // JWT
  /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
  // GitHub / Slack / GitLab / Google / AWS
  /\b(?:ghp|gho|ghs|ghu|github_pat)_[A-Za-z0-9_]{20,}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
  /\bglpat-[A-Za-z0-9_-]{20,}\b/g,
  /\bAIza[0-9A-Za-z_-]{30,}\b/g,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
  // OpenAI 风格 sk- 与 Anthropic sk-ant-（含 DeepSeek 32 位 hex）
  /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g,
  /\bsk-[A-Za-z0-9]{24,}\b/g,
  // 带标签的密钥赋值：api_key=… / secret: … 等
  /\b(?:api[_-]?key|apikey|secret|token|access[_-]?token|password|passwd|pwd)\b\s*[:=]\s*["']?([A-Za-z0-9_\-./+]{12,})["']?/g,
];

const URL_PATTERN = /\bhttps?:\/\/[^\s"'<>()\[\]{}，。；：、]+/g;

const SSH_PATTERNS = [
  /\bssh:\/\/[^\s"'<>()]+/g,
  /\b(?:ssh|scp|sftp)\s+[^\s@\s]+@[^\s:]+(?::\d{1,5})?(?:\s|$)/g,
];

// 仅中国大陆手机号：11 位、1[3-9] 开头，可带 +86/86 前缀，允许 3-4-4 分隔写法。
// 刻意不识别座机与任何外国号码：
//  - (?<![A-Za-z0-9+]) 拒绝数字/字母/加号紧邻（QQ8613812345678、913812345678…）
//  - (?!\d) 拒绝更长数字串的一部分（1381234567890…）
//  - FOREIGN_PREFIX_RE 拒绝「+国家码」引导的号码（+49 17612345678…）
const PHONE_PATTERNS = [
  /(?<![A-Za-z0-9+])(?:\+?86[- ]?)?1[3-9]\d[- ]?\d{4}[- ]?\d{4}(?!\d)/g,
];

const FOREIGN_PREFIX_RE = /(?:^|\s)\+\d{1,3}[- ]?$/;

/** 手机号归一化：去分隔符与 +86/86 前缀 → 纯 11 位数字。 */
const PHONE_NORMALIZER = (v) => String(v).replace(/[\s-]/g, "").replace(/^\+?86/, "");

const NORMALIZERS = { "手机号": PHONE_NORMALIZER };

const IP_PATTERNS = [
  /\b(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\b/g,
  /\b(?:[0-9a-fA-F]{1,4}:){2,7}[0-9a-fA-F]{0,4}\b/g,
];

const ADDRESS_PATTERN =
  /[\u4e00-\u9fa5]{2,8}(?:省|自治区|自治州|市|区|县|镇|街道|乡)[\u4e00-\u9fa50-9A-Za-z\-]{2,30}(?:路|街|巷|道|号|大厦|广场|小区|花园|中心|园区|园|村|苑|城)[^\s，。；；,]{0,20}/g;

/** 去除命中串首尾的装饰性标点。 */
function cleanValue(raw) {
  return String(raw).replace(/^[\s"'([{<>：:，。；]+|[\s"')\]}<>，。；：,.;]+$/g, "").trim();
}

/** 收集某类正则的所有命中，返回 { start, end, value }。 */
function collect(regexes, text) {
  const out = [];
  for (const re of regexes) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      const value = cleanValue(m[0]);
      if (value.length < 3) { re.lastIndex = m.index + 1; continue; }
      // 捕获组模式（带标签密钥）取组 1
      const captured = m[1] !== undefined ? cleanValue(m[1]) : "";
      const v = captured.length >= 3 ? captured : value;
      out.push({ start: m.index, end: m.index + m[0].length, value: v });
      if (m[0].length === 0) re.lastIndex += 1;
    }
  }
  return out;
}

/** 命中区间是否完全落在任意已接受区间内（重叠去重）。 */
function containedBy(hit, accepted) {
  return accepted.some((a) => hit.start >= a.start && hit.end <= a.end);
}

/**
 * 扫描一段文本，按优先级返回建议收录项。
 * @param {string} text - 消息文本。
 * @returns {Array<{category: string, value: string, private: boolean}>}
 */
function scanText(text) {
  const found = [];
  const accepted = [];

  const pushMatches = (category, regexes, isPrivate) => {
    if (found.length >= MAX_MATCHES_PER_MESSAGE) return;
    for (const hit of collect(regexes, text)) {
      if (found.length >= MAX_MATCHES_PER_MESSAGE) return;
      if (containedBy(hit, accepted)) continue;
      if (category === "手机号" && FOREIGN_PREFIX_RE.test(text.slice(Math.max(0, hit.start - 8), hit.start))) continue;
      const value = NORMALIZERS[category] ? NORMALIZERS[category](hit.value) : hit.value;
      if (found.some((f) => f.value === value)) continue;
      found.push({ category, value, private: isPrivate });
      accepted.push({ start: hit.start, end: hit.end, value });
    }
  };

  pushMatches("密钥", KEY_PATTERNS, true);
  pushMatches("网址", [URL_PATTERN], false);
  pushMatches("服务器", SSH_PATTERNS, false);
  pushMatches("手机号", PHONE_PATTERNS, false);
  pushMatches("服务器", IP_PATTERNS, false);
  pushMatches("地址", [ADDRESS_PATTERN], false);

  return found;
}

/** 从会话事件中提取可扫描的文本。 */
function extractMessageText(event) {
  if (!event || typeof event !== "object") return "";
  let content = null;
  switch (event.type) {
    case "user/message":
      content = event.data?.content;
      break;
    case "assistant/message":
      content = event.data?.message?.content;
      break;
    case "tool/result":
      content = event.data?.message?.content;
      break;
    default:
      return "";
  }
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  let out = "";
  for (const block of content) {
    if (block && typeof block.text === "string") out += block.text + "\n";
    else if (block && typeof block.content === "string") out += block.content + "\n";
  }
  return out.slice(0, 200000);
}

// ---------------------------------------------------------------- suggestions store

let store = null; // { version, setup, wrapPw, wrapSec, vault, autoDetect, meta }
let suggestions = null; // { pending: [], seen: [] }
let storeDirtyTimer = null;
let sugDirtyTimer = null;
let currentCtx = null;
let tearDown = false;

function hashKey(category, value) {
  return createHash("sha256").update(category + "\u0000" + value, "utf8").digest("hex");
}

async function loadJson(path, fallback) {
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function loadStoreFiles() {
  const loaded = await loadJson(STORE_PATH, null);
  store = normalizeStore(loaded && typeof loaded === "object" ? loaded : null, null);
  const sug = await loadJson(SUGGESTIONS_PATH, {});
  suggestions = {
    pending: Array.isArray(sug.pending) ? sug.pending.slice(-MAX_PENDING) : [],
    seen: Array.isArray(sug.seen) ? sug.seen : [],
  };
}

function scheduleFlush() {
  if (storeDirtyTimer !== null) return;
  storeDirtyTimer = setTimeout(() => {
    storeDirtyTimer = null;
    void flushStore();
  }, 120);
}

function scheduleSugFlush() {
  if (sugDirtyTimer !== null) return;
  sugDirtyTimer = setTimeout(() => {
    sugDirtyTimer = null;
    void flushSuggestions();
  }, 120);
}

async function atomicWrite(path, data) {
  await mkdir(DATA_ROOT, { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(data), "utf8");
  await rename(tmp, path);
}

async function flushStore() {
  if (!store) return;
  try {
    await atomicWrite(STORE_PATH, store);
  } catch (error) {
    console.error("[chicheng-vault] store flush failed:", error);
  }
}

async function flushSuggestions() {
  if (!suggestions) return;
  try {
    await atomicWrite(SUGGESTIONS_PATH, {
      pending: suggestions.pending.slice(-MAX_PENDING),
      seen: suggestions.seen.slice(-5000),
    });
  } catch (error) {
    console.error("[chicheng-vault] suggestions flush failed:", error);
  }
}

// ---------------------------------------------------------------- watcher

function queueSuggestions(session, found) {
  if (!suggestions) return;
  const now = new Date().toISOString();
  const sessionId = typeof session?.id === "string" ? session.id : "";
  let added = 0;
  for (const item of found) {
    if (suggestions.pending.length >= MAX_PENDING) break;
    const key = hashKey(item.category, item.value);
    if (suggestions.seen.includes(key)) continue;
    if (suggestions.pending.some((p) => p.hash === key)) continue;
    suggestions.pending.push({
      id: randomUUID(),
      hash: key,
      category: item.category,
      value: item.value,
      private: item.private === true,
      at: now,
      sessionId,
    });
    added += 1;
  }
  if (added > 0) {
    scheduleSugFlush();
    try { console.info(`[chicheng-vault] queued ${added} suggestion(s) (pending=${suggestions.pending.length})`); } catch { /* ignore */ }
  }
}

function onSessionEvent(session, event) {
  if (tearDown) return;
  if (!store || store.autoDetect === false) return;
  try {
    const text = extractMessageText(event);
    if (text.length < 3) return;
    const found = scanText(text);
    if (found.length === 0) return;
    queueSuggestions(session, found);
  } catch (error) {
    // 单个事件的处理失败不影响监听器
  }
}

// ---------------------------------------------------------------- API helpers

const MAX_BODY_BYTES = 1 << 20;

class VaultError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

async function readJsonBody(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk);
    total += buffer.length;
    if (total > MAX_BODY_BYTES) throw new VaultError("bad-request", "request body too large", 413);
    chunks.push(buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (text.trim() === "") return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new VaultError("bad-request", "request body is not valid JSON");
  }
}

function writeJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-cache" });
  res.end(payload);
}

function writeOk(res, value) {
  writeJson(res, 200, { ok: true, value });
}

function writeError(res, error) {
  if (error instanceof VaultError) {
    writeJson(res, error.status, { ok: false, error: { code: error.code, message: error.message } });
    return;
  }
  const message = error instanceof Error ? error.message : String(error);
  writeJson(res, 500, { ok: false, error: { code: "internal", message } });
}

function header(headers, key) {
  const value = headers[key];
  return typeof value === "string" ? value : undefined;
}

function parseAuthority(authority) {
  try {
    return new URL(`http://${authority}`);
  } catch {
    return undefined;
  }
}

function isLoopbackHostname(hostname) {
  if (hostname === "localhost" || hostname === "[::1]") return true;
  const parts = hostname.split(".");
  return parts.length === 4 && parts[0] === "127" && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

function isTrustedApiRequest(request, trustedHosts) {
  const host = header(request.headers, "host");
  if (host === undefined) return false;
  const hostUrl = parseAuthority(host);
  if (hostUrl === undefined) return false;
  const hosts = Array.isArray(trustedHosts) ? trustedHosts : [];
  const trusted = hosts.some((entry) => {
    const entryUrl = parseAuthority(entry);
    if (entryUrl === undefined) return false;
    return entryUrl.hostname === hostUrl.hostname && (entryUrl.port === "" || entryUrl.port === hostUrl.port);
  });
  if (!isLoopbackHostname(hostUrl.hostname) && !trusted) return false;
  if (header(request.headers, "sec-fetch-site") === "cross-site") return false;
  const origin = header(request.headers, "origin");
  if (origin === undefined) return true;
  try {
    return new URL(origin).host === hostUrl.host;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- WebDAV proxy
//
// 浏览器直连 WebDAV 常被 CORS 拦下，这里由宿主端转发：客户端把
// { url, method, body, username, password } 交给本代理，代理完成上游请求，
// 凭据仅存在于本次请求内存中，不落盘。

const WEBDAV_MAX_BODY = 16 << 20; // 16 MiB 备份文件上限
const WEBDAV_TIMEOUT_MS = 20000;

async function webdavProxy(payload) {
  const url = String(payload?.url ?? "").trim();
  const method = String(payload?.method ?? "GET").toUpperCase();
  if (!/^https?:\/\//i.test(url)) throw new VaultError("bad-request", "WebDAV 地址必须是 http(s) 开头");
  let upstream;
  try {
    upstream = new URL(url);
  } catch {
    throw new VaultError("bad-request", "WebDAV 地址无效");
  }
  const body = payload?.body;
  const rawBody = typeof body === "string" ? body : body !== undefined ? JSON.stringify(body) : undefined;
  if (rawBody !== undefined && Buffer.byteLength(rawBody, "utf8") > WEBDAV_MAX_BODY) {
    throw new VaultError("bad-request", "WebDAV 请求体过大", 413);
  }
  const username = typeof payload?.username === "string" ? payload.username : "";
  const password = typeof payload?.password === "string" ? payload.password : "";
  const headers = { "user-agent": "chicheng-vault/0.1" };
  if (username !== "") {
    const token = Buffer.from(`${username}:${password}`, "utf8").toString("base64");
    headers.authorization = `Basic ${token}`;
  }
  if (rawBody !== undefined) headers["content-type"] = "application/octet-stream";

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WEBDAV_TIMEOUT_MS);
  try {
    const response = await fetch(upstream, { method, headers, body: rawBody, signal: controller.signal, redirect: "follow" });
    const text = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      body: text.slice(0, WEBDAV_MAX_BODY),
    };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------- API

function buildApi() {
  return {
    /** 面板状态：是否已初始化、自动识别开关、待收录数量。 */
    status: async () => ({
      setup: store?.setup === true,
      autoDetect: store?.autoDetect !== false,
      pendingCount: suggestions?.pending?.length ?? 0,
      dataRoot: DATA_ROOT,
    }),

    /** 读取完整 store（密钥包装 + 私密记录密文 + 非私密明文 + 开关，均为客户端产物）。 */
    loadStore: async () => {
      if (!store) return null;
      return {
        version: store.version,
        setup: store.setup,
        wrapPw: store.wrapPw,
        wrapSec: store.wrapSec,
        vault: store.vault,
        records: store.records,
        autoDetect: store.autoDetect,
        autoLockMinutes: store.autoLockMinutes,
        meta: store.meta,
      };
    },

    /** 保存 store（客户端负责全部加密；合并式写入，缺失字段沿用现有值）。 */
    saveStore: async (payload) => {
      const s = payload?.store;
      if (!s || typeof s !== "object") throw new VaultError("bad-request", "store 缺失");
      store = normalizeStore(s, store);
      scheduleFlush();
      return { saved: true, pendingCount: suggestions?.pending?.length ?? 0 };
    },

    /** 自动识别开关。 */
    saveConfig: async (payload) => {
      if (!store) store = normalizeStore(null, null);
      store.autoDetect = payload?.autoDetect !== false;
      scheduleFlush();
      return { saved: true, autoDetect: store.autoDetect };
    },

    /** 待收录建议列表。 */
    suggestions: async () => ({
      items: (suggestions?.pending ?? []).map((s) => ({
        id: s.id,
        category: s.category,
        value: s.value,
        private: s.private === true,
        at: s.at,
      })),
    }),

    /** 处理待收录建议：ignore=true 永久忽略（记入 seen），否则仅从待收录移除。 */
    suggestAck: async (payload) => {
      if (!suggestions) return { removed: 0 };
      const ids = Array.isArray(payload?.ids) ? payload.ids : [];
      const ignore = payload?.ignore === true;
      const idSet = new Set(ids);
      let removed = 0;
      suggestions.pending = suggestions.pending.filter((s) => {
        if (idSet.size > 0 && !idSet.has(s.id)) return true;
        removed += 1;
        if (ignore && s.hash && !suggestions.seen.includes(s.hash)) suggestions.seen.push(s.hash);
        return false;
      });
      if (removed > 0) scheduleSugFlush();
      return { removed, pendingCount: suggestions.pending.length };
    },

    /** 清空待收录（全部忽略）。 */
    clearSuggestions: async () => {
      if (!suggestions) return { removed: 0 };
      const removed = suggestions.pending.length;
      for (const s of suggestions.pending) {
        if (s.hash && !suggestions.seen.includes(s.hash)) suggestions.seen.push(s.hash);
      }
      suggestions.pending = [];
      scheduleSugFlush();
      return { removed };
    },

    /** WebDAV 代理。 */
    webdav: async (payload) => webdavProxy(payload),
  };
}

// ---------------------------------------------------------------- plugin body

async function apply(ctx, configArg) {
  await loadStoreFiles();
  currentCtx = ctx;
  const fence = (req) => {
    try {
      return isTrustedApiRequest(req, ctx.webRuntime?.trustedHosts ?? []);
    } catch {
      return false;
    }
  };
  const api = buildApi();

  ctx.effect(() => ctx.webServer.register({
    kind: "prefix",
    path: "/vault/api",
    handler: async (req, res) => {
      if (!fence(req)) {
        writeJson(res, 403, { ok: false, error: { code: "forbidden", message: "forbidden" } });
        return;
      }
      if (req.method !== "POST") {
        writeJson(res, 405, { ok: false, error: { code: "method-error", message: "method not allowed" } });
        return;
      }
      const pathname = new URL(req.url ?? "/", "http://vault.invalid").pathname;
      const segments = pathname.split("/").filter(Boolean);
      const method = segments[0] === "vault" && segments[1] === "api" && segments.length === 3 ? segments[2] : undefined;
      if (method === undefined || method.includes("/") || method === "") {
        writeError(res, new VaultError("not-found", "unknown vault API method", 404));
        return;
      }
      try {
        const payload = await readJsonBody(req);
        const handler = api[method];
        if (typeof handler !== "function") throw new VaultError("not-found", `unknown vault API method "${method}"`, 404);
        writeOk(res, await handler(payload));
      } catch (error) {
        writeError(res, error);
      }
    },
  }), "chicheng-vault: /vault/api routes");

  const disposeWatcher = ctx.on("session/event", onSessionEvent);

  ctx.effect(() => () => {
    tearDown = true;
    currentCtx = null;
    try { if (typeof disposeWatcher === "function") disposeWatcher(); } catch { /* ignore */ }
    if (storeDirtyTimer !== null) { clearTimeout(storeDirtyTimer); storeDirtyTimer = null; }
    if (sugDirtyTimer !== null) { clearTimeout(sugDirtyTimer); sugDirtyTimer = null; }
    void flushStore();
    void flushSuggestions();
  }, "chicheng-vault: teardown");

  ctx.logger?.info?.("[chicheng-vault] started, data root: " + DATA_ROOT);
}

export { apply, inject, name, _internals };

/** 测试面：纯函数与常量（本版本内稳定）。 */
const _internals = {
  STORE_PATH,
  SUGGESTIONS_PATH,
  scanText,
  extractMessageText,
  hashKey,
  isTrustedApiRequest,
  cleanValue,
};
