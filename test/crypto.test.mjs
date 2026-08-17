/**
 * chicheng-vault — 加密方案验证（v2 store）。
 * 在 Node 中复刻客户端 WebCrypto 方案（PBKDF2 + AES-GCM 密钥包裹），验证：
 *  setup → 免密读取非私密记录 → unlock（私密内容解密）→ lock（私密内容清空）
 *  → 重新 unlock → reset(安全词) → changePassword → v1 迁移 全链路。
 */
const ITERATIONS = 150000;
const STORE_VERSION = 2;

function b64e(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
  return Buffer.from(bin, "binary").toString("base64");
}

function b64d(str) {
  const bin = Buffer.from(str, "base64").toString("binary");
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function deriveKey(password, saltB64) {
  const salt = b64d(saltB64);
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(String(password)), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: ITERATIONS, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function deriveKeyWithSalt(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(password, b64e(salt));
  return { key, salt: b64e(salt) };
}

async function importVaultKey(rawBytes) {
  return crypto.subtle.importKey("raw", rawBytes, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

async function aesEncrypt(key, dataBytes) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, dataBytes);
  return { iv: b64e(iv), ct: b64e(ct) };
}

async function aesDecrypt(key, ivB64, ctB64) {
  return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64d(ivB64) }, key, b64d(ctB64)));
}

const enc = new TextEncoder();
const dec = new TextDecoder();

let failures = 0;
function assert(name, cond, extra) {
  if (cond) console.log("  ok  " + name);
  else { failures += 1; console.log("FAIL  " + name + (extra ? " :: " + extra : "")); }
}

function emptyStore() {
  const now = new Date().toISOString();
  return { version: STORE_VERSION, setup: true, wrapPw: null, wrapSec: null, webdav: null, records: [], autoDetect: true, autoLockMinutes: 10, meta: { createdAt: now, updatedAt: now } };
}

// ---- 运行时（模拟客户端 runtime）
const runtime = { store: null, key: null, privateById: null, webdav: null };

async function activateKey(kKey) {
  const store = runtime.store;
  const privateById = {};
  for (const r of store.records || []) {
    if (r.private === true && r.enc) {
      try { privateById[r.id] = dec.decode(await aesDecrypt(kKey, r.enc.iv, r.enc.ct)); } catch (e) { privateById[r.id] = ""; }
    }
  }
  let webdav = null;
  if (store.webdav) {
    try { webdav = JSON.parse(dec.decode(await aesDecrypt(kKey, store.webdav.iv, store.webdav.ct))); } catch (e) { webdav = null; }
  }
  runtime.key = kKey;
  runtime.privateById = privateById;
  runtime.webdav = webdav;
}

async function setupVault(password, securityWord) {
  const K = crypto.getRandomValues(new Uint8Array(32));
  const kKey = await importVaultKey(K);
  const pw = await deriveKeyWithSalt(password);
  const sec = await deriveKeyWithSalt(securityWord);
  const store = emptyStore();
  store.wrapPw = Object.assign({ salt: pw.salt }, await aesEncrypt(pw.key, K));
  store.wrapSec = Object.assign({ salt: sec.salt }, await aesEncrypt(sec.key, K));
  runtime.store = store;
  runtime.key = kKey;
  runtime.privateById = {};
  runtime.webdav = null;
  return store;
}

async function unlockVault(password) {
  const store = runtime.store;
  const pwKey = await deriveKey(password, store.wrapPw.salt);
  const K = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64d(store.wrapPw.iv) }, pwKey, b64d(store.wrapPw.ct)));
  await activateKey(await importVaultKey(K));
}

function lockVault() {
  runtime.key = null;
  runtime.privateById = null;
  runtime.webdav = null;
}

async function resetWithSecurityWord(securityWord, newPassword, newSecurityWord) {
  const store = runtime.store;
  const secKey = await deriveKey(securityWord, store.wrapSec.salt);
  const K = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64d(store.wrapSec.iv) }, secKey, b64d(store.wrapSec.ct)));
  const kKey = await importVaultKey(K);
  const pw = await deriveKeyWithSalt(newPassword);
  store.wrapPw = Object.assign({ salt: pw.salt }, await aesEncrypt(pw.key, K));
  if (newSecurityWord) {
    const sec2 = await deriveKeyWithSalt(newSecurityWord);
    store.wrapSec = Object.assign({ salt: sec2.salt }, await aesEncrypt(sec2.key, K));
  }
  await activateKey(kKey);
}

async function changePassword(currentPassword, newPassword) {
  const store = runtime.store;
  const pwKey = await deriveKey(currentPassword, store.wrapPw.salt);
  const K = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64d(store.wrapPw.iv) }, pwKey, b64d(store.wrapPw.ct)));
  const pw2 = await deriveKeyWithSalt(newPassword);
  store.wrapPw = Object.assign({ salt: pw2.salt }, await aesEncrypt(pw2.key, K));
}

async function recordEncrypt(key, text) {
  return aesEncrypt(key, enc.encode(String(text || "")));
}

// ---- 镜像客户端 v2 的兼容性逻辑（多 KDF 参数解包 + 空 vault 迁移）

const PBKDF2_VARIANTS = [
  { iterations: 150000, hash: "SHA-256" },
  { iterations: 100000, hash: "SHA-256" },
  { iterations: 600000, hash: "SHA-256" },
  { iterations: 310000, hash: "SHA-256" },
  { iterations: 200000, hash: "SHA-256" },
  { iterations: 10000, hash: "SHA-256" },
  { iterations: 1000, hash: "SHA-256" },
  { iterations: 150000, hash: "SHA-512" },
  { iterations: 100000, hash: "SHA-512" },
  { iterations: 150000, hash: "SHA-1" },
  { iterations: 100000, hash: "SHA-1" },
];

async function deriveKeyV(password, saltB64, iterations, hash) {
  const salt = b64d(saltB64);
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(String(password)), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations, hash: hash || "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function unwrapWrappedKeyMirror(store, password, which) {
  const wrap = which === "wrapSec" ? store.wrapSec : store.wrapPw;
  if (!wrap || !wrap.salt || !wrap.iv || !wrap.ct) throw new Error("no-wrap");
  let lastErr = null;
  const tryOne = async (pwText, variant) => {
    const pwKey = await deriveKeyV(pwText, wrap.salt, variant.iterations, variant.hash);
    return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64d(wrap.iv) }, pwKey, b64d(wrap.ct)));
  };
  for (const variant of PBKDF2_VARIANTS) {
    try { return { K: await tryOne(password, variant), variant, trimmed: false }; } catch (e) { lastErr = e; }
  }
  const trimmed = String(password).replace(/[ \t]+$/, "");
  if (trimmed !== String(password)) {
    for (const variant of PBKDF2_VARIANTS) {
      try { return { K: await tryOne(trimmed, variant), variant, trimmed: true }; } catch (e) { lastErr = e; }
    }
  }
  throw lastErr || new Error("bad-password");
}

// 镜像客户端 migrateV1（vault 缺失/空 → 空库迁移；wrapPw 升级标准 KDF）
async function migrateV1Mirror(password) {
  const store = runtime.store;
  if (!store || !store.wrapPw) throw new Error("not-v1");
  const unwrapped = await unwrapWrappedKeyMirror(store, password, "wrapPw");
  const kKey = await importVaultKey(unwrapped.K);
  let vaultObj = null;
  if (store.vault && store.vault.iv && store.vault.ct) {
    try { vaultObj = JSON.parse(dec.decode(await aesDecrypt(kKey, store.vault.iv, store.vault.ct))); } catch (e) { vaultObj = null; }
  }
  if (!vaultObj) vaultObj = { version: 1, records: [], webdav: null, autoLockMinutes: 10 };
  const now = new Date().toISOString();
  const pw = await deriveKeyWithSalt(password);
  const v2 = {
    version: STORE_VERSION,
    setup: true,
    wrapPw: Object.assign({ salt: pw.salt }, await aesEncrypt(pw.key, unwrapped.K)),
    wrapSec: store.wrapSec || null,
    webdav: null,
    records: [],
    autoDetect: store.autoDetect !== false,
    autoLockMinutes: Number(vaultObj.autoLockMinutes) > 0 ? Number(vaultObj.autoLockMinutes) : 10,
    meta: Object.assign({}, store.meta || {}, { updatedAt: now }),
  };
  if (vaultObj.webdav) v2.webdav = await aesEncrypt(kKey, enc.encode(JSON.stringify(vaultObj.webdav)));
  for (const r of vaultObj.records || []) {
    const base = { id: r.id || "x", name: String(r.name || ""), category: String(r.category || "其他").trim() || "其他", tags: Array.isArray(r.tags) ? r.tags : [], createdAt: r.createdAt || now, updatedAt: r.updatedAt || now };
    const isPrivate = r.private === true || r.isPrivate === true || r.secret === true;
    if (isPrivate) v2.records.push(Object.assign({}, base, { private: true, content: null, enc: await aesEncrypt(kKey, enc.encode(String(r.content || ""))) }));
    else v2.records.push(Object.assign({}, base, { private: false, content: String(r.content || "") }));
  }
  runtime.store = v2;
  await activateKey(kKey);
  return v2;
}

// ============================================================ tests

// ---- setup + 非私密记录免密可见
{
  const store = await setupVault("pass-1234", "小狗汪汪");
  // 添加两条记录：一条私密、一条非私密
  const pub = { id: "r1", name: "测试服务器", category: "服务器", tags: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), private: false, content: "ssh://root@1.2.3.4" };
  const enc1 = await recordEncrypt(runtime.key, "sk-verysecret123456");
  const priv = { id: "r2", name: "API Key", category: "密钥", tags: ["prod"], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), private: true, content: null, enc: enc1 };
  store.records.push(pub, priv);
  // WebDAV 配置加密
  store.webdav = await aesEncrypt(runtime.key, enc.encode(JSON.stringify({ url: "https://dav.example.com/dav/", username: "u", password: "p" })));

  // 锁定后：非私密记录仍可见，私密记录不可见
  lockVault();
  assert("locked: non-private visible", store.records.find((r) => r.id === "r1").content === "ssh://root@1.2.3.4");
  assert("locked: private content not in store", store.records.find((r) => r.id === "r2").content === null);
  assert("locked: private has enc", !!store.records.find((r) => r.id === "r2").enc);

  // 错误密码解锁失败
  let wrong = true;
  try { await unlockVault("wrong-pw"); wrong = false; } catch (e) { /* expected */ }
  assert("wrong password rejected", wrong);

  // 正确密码解锁：私密内容解密
  await unlockVault("pass-1234");
  assert("unlocked: private decrypted", runtime.privateById["r2"] === "sk-verysecret123456", JSON.stringify(runtime.privateById));
  assert("unlocked: webdav decrypted", runtime.webdav && runtime.webdav.url === "https://dav.example.com/dav/", JSON.stringify(runtime.webdav));

  // 解锁一次后仍有效（不重复验证）
  assert("stays unlocked", runtime.key !== null && runtime.privateById["r2"] === "sk-verysecret123456");

  // 锁定清空私密明文
  lockVault();
  assert("relock clears private", runtime.privateById === null && runtime.webdav === null);
  assert("non-private still fine after relock", store.records.find((r) => r.id === "r1").content === "ssh://root@1.2.3.4");
  await unlockVault("pass-1234");
  assert("re-unlock works", runtime.privateById["r2"] === "sk-verysecret123456");

  // 新增私密记录（解锁态）→ 锁定后再解锁可见
  const enc2 = await recordEncrypt(runtime.key, "ghp_newtoken_abcdefghijklmnopqrstuvwxyz012345");
  store.records.push({ id: "r3", name: "GitHub", category: "密钥", tags: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), private: true, content: null, enc: enc2 });
  lockVault();
  await unlockVault("pass-1234");
  assert("added private record decrypts", runtime.privateById["r3"].indexOf("ghp_") === 0);
}

// ---- changePassword：换密码后旧密码失效、新密码可用
{
  const store = runtime.store;
  await changePassword("pass-1234", "new-pass-5678");
  let oldWorks = true;
  try { await unlockVault("pass-1234"); oldWorks = false; } catch (e) { /* expected */ }
  assert("old password invalid after change", oldWorks);
  lockVault();
  await unlockVault("new-pass-5678");
  assert("new password works after change", runtime.privateById["r2"] === "sk-verysecret123456");
  // 改回，避免影响后续
  await changePassword("new-pass-5678", "pass-1234");
  lockVault();
  await unlockVault("pass-1234");
}

// ---- reset（安全词）：不依赖旧密码
{
  const store = runtime.store;
  const before = store.wrapPw.ct;
  lockVault();
  await resetWithSecurityWord("小狗汪汪", "reset-pass-0000", "新安全词");
  assert("wrapPw changed by reset", store.wrapPw.ct !== before);
  assert("reset unlocks immediately", runtime.privateById["r2"] === "sk-verysecret123456");
  let secOld = true;
  lockVault();
  try { await unlockVault("pass-1234"); secOld = false; } catch (e) { /* expected */ }
  assert("old password invalid after reset", secOld);
  await unlockVault("reset-pass-0000");
  assert("reset password works", runtime.privateById["r2"] === "sk-verysecret123456");
  // 新安全词可再次重置
  lockVault();
  await resetWithSecurityWord("新安全词", "pass-1234", "小狗汪汪");
  lockVault();
  await unlockVault("pass-1234");
  assert("restored password via new security word", runtime.privateById["r2"] === "sk-verysecret123456");
  // 被替换掉的旧安全词失效
  lockVault();
  let secNew = true;
  try { await resetWithSecurityWord("新安全词", "x", "x"); secNew = false; } catch (e) { /* expected */ }
  assert("old security word invalid after reset", secNew);
  lockVault();
  await unlockVault("pass-1234");
}

// ---- v1 → v2 迁移（vault 存在，标准 KDF）
{
  // 构造 v1 store：整库用 K 加密
  const K = crypto.getRandomValues(new Uint8Array(32));
  const kKey = await importVaultKey(K);
  const pw = await deriveKeyWithSalt("legacy-pw");
  const sec = await deriveKeyWithSalt("legacy-sec");
  const v1Vault = {
    version: 1,
    records: [
      { id: "a", name: "旧公开", category: "其他", tags: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), private: false, content: "public-data" },
      { id: "b", name: "旧私密", category: "密钥", tags: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), private: true, content: "secret-data" },
      { id: "c", name: "旧字段名", category: "其他", tags: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), isPrivate: true, content: "alias-secret" },
    ],
    webdav: { url: "https://old.example.com/", username: "ou", password: "op" },
    autoLockMinutes: 5,
  };
  const v1Store = {
    version: 1,
    setup: true,
    wrapPw: Object.assign({ salt: pw.salt }, await aesEncrypt(pw.key, K)),
    wrapSec: Object.assign({ salt: sec.salt }, await aesEncrypt(sec.key, K)),
    vault: await aesEncrypt(kKey, enc.encode(JSON.stringify(v1Vault))),
    autoDetect: true,
    meta: { createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  };

  // 迁移（用旧密码，走镜像 migrateV1）
  const oldRuntime = runtime.store;
  runtime.store = v1Store;
  const v2 = await migrateV1Mirror("legacy-pw");
  assert("migrated: non-private plaintext", v2.records.find((r) => r.id === "a").content === "public-data");
  assert("migrated: private encrypted", v2.records.find((r) => r.id === "b").content === null && !!v2.records.find((r) => r.id === "b").enc);
  assert("migrated: private decrypts", runtime.privateById["b"] === "secret-data");
  assert("migrated: isPrivate alias treated private", runtime.privateById["c"] === "alias-secret");
  assert("migrated: webdav decrypts", runtime.webdav && runtime.webdav.url === "https://old.example.com/", JSON.stringify(runtime.webdav));
  assert("migrated: autoLockMinutes kept", v2.autoLockMinutes === 5);
  assert("migrated: version=2", v2.version === 2);
  // wrapPw 已升级为标准 KDF：旧参数（150000/SHA-256）可直接解开，且换盐后 wrapPw 变化
  const pwKey2 = await deriveKey("legacy-pw", v2.wrapPw.salt);
  const K3 = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64d(v2.wrapPw.iv) }, pwKey2, b64d(v2.wrapPw.ct)));
  assert("migrated: wrapPw unwraps with standard KDF", K3.length === 32);
  runtime.store = oldRuntime; // 还原，避免影响后续
  lockVault();
  await unlockVault("pass-1234");
  assert("final unlock ok", runtime.privateById["r2"] === "sk-verysecret123456");
}

// ---- v1 迁移：旧库用非标准 KDF（100000 迭代）→ 兼容矩阵应能解开
{
  const K = crypto.getRandomValues(new Uint8Array(32));
  const kKey = await importVaultKey(K);
  const oldPw = await deriveKeyWithSalt("legacy-100k");
  // 用 100000/SHA-256 派生旧 wrapPw（模拟早期版本的 KDF）
  const pwKey100 = await deriveKeyV("legacy-100k", oldPw.salt, 100000, "SHA-256");
  const v1Store = {
    version: 1,
    setup: true,
    wrapPw: Object.assign({ salt: oldPw.salt }, await aesEncrypt(pwKey100, K)),
    wrapSec: null,
    vault: await aesEncrypt(kKey, enc.encode(JSON.stringify({ version: 1, records: [], webdav: null, autoLockMinutes: 10 }))),
    autoDetect: true,
    meta: { createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  };
  const oldRuntime = runtime.store;
  runtime.store = v1Store;
  const v2 = await migrateV1Mirror("legacy-100k");
  assert("legacy KDF: migration succeeds", v2.version === 2);
  assert("legacy KDF: wrapPw upgraded to standard", v2.wrapPw.salt !== v1Store.wrapPw.salt);
  lockVault();
  await unlockVault("legacy-100k");
  assert("legacy KDF: unlock with same password after migrate", runtime.key !== null);
  runtime.store = oldRuntime;
  lockVault();
  await unlockVault("pass-1234");
}

// ---- v1 迁移：vault 缺失（历史 bug：密文未落盘）→ 按空库迁移，不报「密码错误」
{
  const K = crypto.getRandomValues(new Uint8Array(32));
  const kKey = await importVaultKey(K);
  const pw = await deriveKeyWithSalt("pw-novault");
  const sec = await deriveKeyWithSalt("sec-novault");
  const v1Empty = {
    version: 1,
    setup: true,
    wrapPw: Object.assign({ salt: pw.salt }, await aesEncrypt(pw.key, K)),
    wrapSec: Object.assign({ salt: sec.salt }, await aesEncrypt(sec.key, K)),
    vault: null, // 真实磁盘状态（store.json 里 vault 为 null）
    autoDetect: true,
    meta: { createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  };
  const oldRuntime = runtime.store;
  runtime.store = v1Empty;
  const v2 = await migrateV1Mirror("pw-novault");
  assert("empty vault: migrates as empty", v2.version === 2 && v2.records.length === 0);
  // 错误密码仍然拒绝
  runtime.store = v1Empty;
  let bad = true;
  try { await migrateV1Mirror("wrong-pw"); bad = false; } catch (e) { /* expected */ }
  assert("empty vault: wrong password still rejected", bad);
  runtime.store = oldRuntime;
  lockVault();
  await unlockVault("pass-1234");
  assert("final unlock ok (after empty-vault cases)", runtime.privateById["r2"] === "sk-verysecret123456");
}

// ---- 私密记录编辑/改公开
{
  const store = runtime.store;
  const rec = store.records.find((r) => r.id === "r2");
  // 改公开：内容明文，enc 删除
  rec.private = false;
  rec.content = "now-public";
  delete rec.enc;
  assert("private→public: plaintext", rec.content === "now-public" && rec.enc === undefined);
  // 再改回私密（解锁态）：重新加密
  rec.private = true;
  rec.content = null;
  rec.enc = await recordEncrypt(runtime.key, "re-secret");
  lockVault();
  await unlockVault("pass-1234");
  assert("public→private re-encrypted", runtime.privateById["r2"] === "re-secret");
}

console.log(failures === 0 ? "\nAll crypto tests passed." : `\n${failures} failure(s).`);
process.exit(failures === 0 ? 0 : 1);
