/**
 * chicheng-vault — client bundle load test.
 * Runs the bundle inside a vm sandbox with a mock window.__ModuleLoader__ and
 * require, then invokes the registered factory to verify exports.apply /
 * exports.inject without executing any React rendering.
 */
import { readFile } from "node:fs/promises";
import vm from "node:vm";

let failures = 0;
function assert(name, cond, extra) {
  if (cond) console.log("  ok  " + name);
  else { failures += 1; console.log("FAIL  " + name + (extra ? " :: " + extra : "")); }
}

let registered = null;
const sandbox = {
  window: {
    __ModuleLoader__: {
      load(entry) {
        registered = entry;
      },
    },
  },
  console,
  setTimeout,
  clearTimeout,
  TextEncoder,
  TextDecoder,
  btoa,
  atob,
};
vm.createContext(sandbox);

const source = await readFile(new URL("../lib/client.js", import.meta.url), "utf8");
assert("bundle registers via __ModuleLoader__.load", source.indexOf("window.__ModuleLoader__.load") !== -1);

vm.runInContext(source, sandbox);
assert("bundle registered", registered !== null && registered.id === "chicheng-vault", JSON.stringify(registered && registered.id));

// stub enough of react / react-dom / primitives for the factory body to load
const reactStub = {
  useState: () => [undefined, () => {}],
  useEffect: () => {},
  useRef: () => ({ current: undefined }),
  useCallback: (fn) => fn,
  useMemo: (fn) => fn(),
  createElement: () => ({ $$vault: "stub" }),
  Fragment: "Fragment",
};
const reactDomStub = { createPortal: (node) => node };
const primitivesStub = new Proxy({}, {
  get: (_t, prop) => {
    if (prop === "Button") return () => null;
    if (typeof prop === "string" && prop.startsWith("Icon")) return () => null;
    return undefined;
  },
});

const fakeRequire = (id) => {
  if (id === "react") return reactStub;
  if (id === "react-dom") return reactDomStub;
  if (id === "@deepseek-ai/dsh-client-ui-primitives") return primitivesStub;
  throw new Error("unexpected require: " + id);
};

const exportsObj = registered.factory(fakeRequire);
assert("exports.apply is function", typeof exportsObj.apply === "function");
assert("exports.inject is ['slots']", Array.isArray(exportsObj.inject) && exportsObj.inject[0] === "slots", JSON.stringify(exportsObj.inject));

// host half exports
const host = await import("../lib/index.js");
assert("host exports apply/inject", typeof host.apply === "function" && Array.isArray(host.inject));
assert("host internals exposed", typeof host._internals.scanText === "function" && typeof host._internals.extractMessageText === "function");

console.log(failures === 0 ? "\nAll bundle tests passed." : `\n${failures} failure(s).`);
process.exit(failures === 0 ? 0 : 1);
