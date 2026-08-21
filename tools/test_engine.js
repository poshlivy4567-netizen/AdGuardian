// Диагностика движка AdGuardian на реальных списках (Node, без chrome API).
const fs = require("fs");
const path = require("path");
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
const root = path.resolve(__dirname, "..");
vm.runInContext(fs.readFileSync(path.join(root, "lib", "filters.js"), "utf8"), sandbox);

const files = {
  easylist: path.join(__dirname, "easylist.txt"),
  "adguard-ru": path.join(__dirname, "adguard_ru.txt"),
  easyprivacy: path.join(__dirname, "easyprivacy.txt"),
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
  sandbox.globalThis.STATIC_POPUP_BLOCKS = subscriptions.meta.staticPopupBlocks;
  sandbox.globalThis.STATIC_TRACKER_BLOCKS = subscriptions.meta.staticTrackerBlocks;
  sandbox.globalThis.STATIC_GENERIC_BLOCKS = subscriptions.meta.staticGenericBlocks;
  const dnr = sandbox.buildDnrRules(parsed);
  console.log("Упакованный ruleset:", subscriptions.rules.length);
  console.log("popup-блоков в статики:", subscriptions.meta.staticPopupBlocks);
  console.log("ИТОГО DNR-правил:", dnr.length);
  // валидность id и типов
  const ids = new Set(dnr.map((r) => r.id));
  console.log("уникальных id:", ids.size, "| дубликатов:", dnr.length - ids.size);
  const staticKeys = new Set(subscriptions.rules.map((rule) => sandbox.ruleKey(rule)));
  const dynamicOnly = dnr.filter((rule) => !staticKeys.has(sandbox.ruleKey(rule))).length;
  console.log("Дополнительно к статике:", dynamicOnly, "| всего уникальных:", staticKeys.size + dynamicOnly);
  const badAction = dnr.filter((r) => !r.action || !r.action.type);
  console.log("правил без action:", badAction.length);
  const builtinRules = JSON.parse(fs.readFileSync(path.join(root, "rules", "ads_rules.json"), "utf8"));
  const builtinIds = new Set(builtinRules.map((rule) => rule.id));
  if (builtinIds.size !== builtinRules.length) throw new Error("дубликаты id в ручных правилах");
  if (subscriptions.rules.length + builtinRules.length > 30000) {
    throw new Error("статические rulesets превышают гарантированную квоту Chrome");
  }

  const samples = [
    ["||cdn.example^$script,image,~font", false, { resourceTypes: ["script", "image"], excludedResourceTypes: ["font"] }],
    ["||ad.example^$domain=site.ru|~safe.site.ru", false, { domains: ["site.ru"], excludedDomains: ["safe.site.ru"] }],
    ["@@||cdn.example^$third-party", true, { domainType: "thirdParty" }],
    ["@@||site.example^$document", true, { resourceTypes: ["main_frame"] }],
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
  const documentRule = sandbox.convertNetworkRule("||site.example^", true, "document");
  if (documentRule.action.type !== "allowAllRequests") {
    throw new Error("исключение $document не превращено в allowAllRequests");
  }
  const popupBlock = sandbox.convertNetworkRule("||popnetwork.example^", false, "popup,third-party");
  if (!popupBlock
    || popupBlock.action.type !== "block"
    || JSON.stringify(popupBlock.condition.resourceTypes) !== JSON.stringify(["main_frame"])
    || popupBlock.condition.domainType !== "thirdParty") {
    throw new Error("$popup не превращён в блокировку main_frame");
  }
  if (sandbox.convertNetworkRule("||popnetwork.example^", true, "popup")) {
    throw new Error("исключение $popup должно пропускаться");
  }
  if (sandbox.convertNetworkRule("||pop.example^", false, "popup,subdocument")) {
    throw new Error("смешение $popup с типами ресурсов должно пропускаться");
  }
  console.log("проверки парсера: пройдены");
} catch (e) {
  console.error("ДВИЖОК УПАЛ:", e && e.stack ? e.stack : e);
  process.exit(1);
}
