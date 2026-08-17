/**
 * chicheng-vault — 模式识别纯函数测试。
 */
import { _internals as I } from "../lib/index.js";

let failures = 0;
function assert(name, cond, extra) {
  if (cond) console.log("  ok  " + name);
  else { failures += 1; console.log("FAIL  " + name + (extra ? " :: " + extra : "")); }
}

const { scanText, extractMessageText } = I;

// ---- keys
{
  const found = scanText("我的 key 是 sk-abc1234567890abcdef1234567890，别外传。");
  const keys = found.filter((f) => f.category === "密钥");
  assert("sk- token detected", keys.some((k) => k.value === "sk-abc1234567890abcdef1234567890"), JSON.stringify(found));
  assert("key is private", keys.every((k) => k.private === true), JSON.stringify(keys));
}

{
  const found = scanText("token: ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789");
  assert("github token detected", found.some((f) => f.category === "密钥" && f.value.indexOf("ghp_") === 0), JSON.stringify(found));
}

{
  const found = scanText("JWT: eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U");
  assert("jwt detected", found.some((f) => f.category === "密钥" && f.value.indexOf("eyJ") === 0), JSON.stringify(found));
}

{
  const found = scanText("-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEAu1Z\n-----END RSA PRIVATE KEY-----");
  assert("pem key detected", found.some((f) => f.category === "密钥" && f.value.indexOf("BEGIN RSA") !== -1), JSON.stringify(found));
}

{
  const found = scanText("api_key = sk-abcdefghijklmnop1234567890abcdef 和 secret: xyzABCDEFGHIJKLMNOP123456");
  const keys = found.filter((f) => f.category === "密钥");
  assert("labeled key detected", keys.some((k) => k.value === "sk-abcdefghijklmnop1234567890abcdef"), JSON.stringify(keys));
}

// ---- urls
{
  const found = scanText("去 https://example.com/path?q=1 看看，还有 http://a.b.cn:8080/x。");
  const urls = found.filter((f) => f.category === "网址").map((f) => f.value);
  assert("two urls detected", urls.length === 2, JSON.stringify(urls));
  assert("url without trailing punctuation", urls.every((u) => !/[，。；]$/.test(u)), JSON.stringify(urls));
}

// ---- servers (ssh)
{
  const found = scanText("连服务器：ssh://root@1.2.3.4:2222，或者 ssh admin@example.com");
  const servers = found.filter((f) => f.category === "服务器").map((f) => f.value);
  assert("ssh server detected", servers.some((s) => s.indexOf("ssh://") === 0), JSON.stringify(found));
}

// ---- phones (仅中国大陆手机号)
{
  const found = scanText("电话 13800138000 或 +86 13912345678，座机 010-88886666");
  const phones = found.filter((f) => f.category === "手机号").map((f) => f.value);
  assert("cn mobile detected", phones.includes("13800138000"), JSON.stringify(phones));
  assert("+86 mobile normalized", phones.includes("13912345678"), JSON.stringify(phones));
  assert("landline not detected", !phones.some((p) => p.indexOf("010") === 0), JSON.stringify(phones));
}

// ---- phones: 分隔写法与 86 前缀
{
  const found = scanText("联系 138-1234-5678 或 86 139 1234 5678");
  const phones = found.filter((f) => f.category === "手机号").map((f) => f.value);
  assert("separated cn mobile normalized", phones.includes("13812345678"), JSON.stringify(phones));
  assert("86-prefixed cn mobile normalized", phones.includes("13912345678"), JSON.stringify(phones));
}

// ---- phones: 拒绝外国号码与随机数字串
{
  const found = scanText("美 +1 555-123-4567，德 +49 17612345678，日 +81 90-1234-5678，随机 12345678901，QQ8613812345678，订单913812345678");
  const phones = found.filter((f) => f.category === "手机号").map((f) => f.value);
  assert("no foreign numbers", phones.length === 0, JSON.stringify(phones));
}

// ---- ips
{
  const found = scanText("内网 192.168.1.10，公网 8.8.8.8");
  const ips = found.filter((f) => f.category === "服务器" && f.value.indexOf("://") === -1).map((f) => f.value);
  assert("ipv4 detected", ips.includes("192.168.1.10") && ips.includes("8.8.8.8"), JSON.stringify(found));
}

// ---- addresses
{
  const found = scanText("发货到 广东省深圳市南山区科技园南路88号 或 上海市浦东新区张江高科技园区博云路2号");
  const addrs = found.filter((f) => f.category === "地址").map((f) => f.value);
  assert("cn address detected", addrs.length >= 1 && addrs.some((a) => a.indexOf("省") !== -1 || a.indexOf("市") !== -1), JSON.stringify(addrs));
}

// ---- overlap: ssh url should not also produce a bare ip record
{
  const found = scanText("ssh://root@1.2.3.4");
  const values = found.map((f) => f.category + ":" + f.value);
  assert("no duplicate ip inside ssh url", found.filter((f) => f.value === "1.2.3.4").length === 0, JSON.stringify(values));
}

// ---- dedupe within one message
{
  const found = scanText("https://a.com 和 https://a.com");
  assert("duplicate url deduped", found.filter((f) => f.category === "网址").length === 1, JSON.stringify(found));
}

// ---- extractMessageText
{
  const text = extractMessageText({
    type: "user/message",
    data: { content: [{ kind: "text", text: "你好 123" }, { kind: "text", text: " 456" }] },
  });
  assert("user/message text extracted", text.indexOf("你好 123") !== -1 && text.indexOf("456") !== -1, JSON.stringify(text));
}

{
  const text = extractMessageText({
    type: "assistant/message",
    data: { message: { content: [{ kind: "text", text: "回复内容 abc" }] } },
  });
  assert("assistant/message text extracted", text.indexOf("abc") !== -1, JSON.stringify(text));
}

{
  const text = extractMessageText({ type: "turn/start", data: {} });
  assert("non-message event yields empty", text === "", JSON.stringify(text));
}

{
  const text = extractMessageText({ type: "user/message", data: { content: "直接字符串" } });
  assert("string content accepted", text === "直接字符串", JSON.stringify(text));
}

console.log(failures === 0 ? "\nAll matcher tests passed." : `\n${failures} failure(s).`);
process.exit(failures === 0 ? 0 : 1);
