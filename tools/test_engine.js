// Диагностика движка AdGuardian на реальных списках (Node, без chrome API).
const fs = require("fs");
const vm = require("vm");

const sandbox = {
  console,
  setTimeout,
  clearTimeout,
  fetch,
  URL,
  AbortController,
  globalThis: {},
  chrome: {}, // не используется в parseFilters/buildDnrRules
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync("lib/filters.js", "utf8"), sandbox);

const BASE = __dirname + "/cache/";
const files = {
  easylist: BASE + "easylist.txt",
  "adguard-ru": BASE + "ag.txt",
  easyprivacy: BASE + "easyprivacy.txt",
};

try {
  const parsed = [];
  for (const [name, path] of Object.entries(files)) {
    const text = fs.readFileSync(path, "utf8");
    const p = sandbox.parseFilters(text);
    parsed.push({ name, ...p });
    console.log(`${name}: blocks=${p.blocks.length}, allows=${p.allows.length}`);
  }
  const subscriptions = sandbox.buildSubscriptionRules(parsed);
  sandbox.globalThis.STATIC_TRACKER_BLOCKS = subscriptions.meta.staticTrackerBlocks;
  sandbox.globalThis.STATIC_GENERIC_BLOCKS = subscriptions.meta.staticGenericBlocks;
  const dnr = sandbox.buildDnrRules(parsed);
  console.log("Упакованный ruleset:", subscriptions.rules.length);
  console.log("ИТОГО DNR-правил:", dnr.length);
  // валидность id и типов
  const ids = new Set(dnr.map((r) => r.id));
  console.log("уникальных id:", ids.size, "| дубликатов:", dnr.length - ids.size);
  const staticKeys = new Set(subscriptions.rules.map((rule) => sandbox.ruleKey(rule)));
  const dynamicOnly = dnr.filter((rule) => !staticKeys.has(sandbox.ruleKey(rule))).length;
  console.log("Дополнительно к статике:", dynamicOnly, "| всего уникальных:", staticKeys.size + dynamicOnly);
  const badAction = dnr.filter((r) => !r.action || !r.action.type);
  console.log("правил без action:", badAction.length);

  const samples = [
    ["||cdn.example^$script,image,~font", false, { resourceTypes: ["script", "image"], excludedResourceTypes: ["font"] }],
    ["||ad.example^$domain=site.ru|~safe.site.ru", false, { domains: ["site.ru"], excludedDomains: ["safe.site.ru"] }],
    ["@@||cdn.example^$third-party", true, { domainType: "thirdParty" }],
  ];
  for (const [line, exception, expected] of samples) {
    const [body, options] = sandbox.splitOptions(line.replace(/^@@/, ""));
    const rule = sandbox.convertNetworkRule(body, exception, options);
    for (const [key, value] of Object.entries(expected)) {
      if (JSON.stringify(rule.condition[key]) !== JSON.stringify(value)) {
        throw new Error(`Не распознана опция ${key} в ${line}`);
      }
    }
  }
  if (sandbox.convertNetworkRule("||example^", false, "redirect=noopjs")) {
    throw new Error("Неподдерживаемый redirect не был пропущен");
  }
  if (sandbox.convertNetworkRule("||теплорасчет.рф^", false, "")) {
    throw new Error("Unicode URL-фильтр не был пропущен");
  }
  if (!sandbox.isCosmeticRule("example.com##.ad-slot")) {
    throw new Error("Косметическое правило не отфильтровано");
  }
  console.log("проверки парсера: пройдены");
} catch (e) {
  console.error("ДВИЖОК УПАЛ:", e && e.stack ? e.stack : e);
  process.exit(1);
}
