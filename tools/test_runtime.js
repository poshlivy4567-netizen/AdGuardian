// Проверяет, что обновление динамических фильтров не удаляет исключения сайтов.
const assert = require("assert");
const fs = require("fs");
const vm = require("vm");

const store = {
  enabled: true,
  filterRules: 0,
  filters_cache: {
    easylist: { text: "||ads.example^\n||analytics.example^$xmlhttprequest" },
    "adguard-ru": { text: "||ru-ad.example^$script,image" },
    easyprivacy: { text: "@@||allowed.example^\n||tracker.example^$third-party" },
  },
};
let dynamicRules = [{
  id: 1,
  priority: 100,
  action: { type: "allowAllRequests" },
  condition: { requestDomains: ["safe.example"], resourceTypes: ["main_frame", "sub_frame"] },
}];

const chrome = {
  storage: { local: {
    async get(defaults) {
      if (typeof defaults === "string") return { [defaults]: store[defaults] };
      return Object.fromEntries(Object.entries(defaults).map(([key, value]) => [key, key in store ? store[key] : value]));
    },
    async set(values) { Object.assign(store, values); },
  } },
  declarativeNetRequest: {
    async getDynamicRules() { return structuredClone(dynamicRules); },
    async updateDynamicRules({ removeRuleIds = [], addRules = [] }) {
      dynamicRules = dynamicRules.filter((rule) => !removeRuleIds.includes(rule.id));
      const ids = new Set(dynamicRules.map((rule) => rule.id));
      for (const rule of addRules) {
        if (ids.has(rule.id)) throw new Error(`duplicate id ${rule.id}`);
        ids.add(rule.id); dynamicRules.push(rule);
      }
    },
  },
};

const sandbox = { console, chrome, setTimeout, clearTimeout, URL, AbortController, globalThis: { STATIC_TRACKER_BLOCKS: 0, STATIC_GENERIC_BLOCKS: 0 } };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync("lib/filters.js", "utf8"), sandbox);

(async () => {
  const count = await sandbox.applyCachedFilters();
  assert(count > 0, "filters should be compiled");
  assert(dynamicRules.some((rule) => rule.id === 1), "site allow rule must survive filter refresh");
  assert(dynamicRules.filter((rule) => rule.id >= 100000).length === count, "all generated rules should use filter id range");
  assert.strictEqual(store.dynamicRulesReady, true, "successful build should be cached as ready");

  const before = structuredClone(dynamicRules);
  store.enabled = false;
  await sandbox.applyCachedFilters();
  assert.strictEqual(JSON.stringify(dynamicRules), JSON.stringify(before), "disabled blocker must not alter dynamic rules");
  console.log("runtime integration: passed");
})().catch((error) => { console.error(error); process.exit(1); });
