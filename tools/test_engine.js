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
  chrome: {},
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "lib", "filters.js"), "utf8"), sandbox);

function findSourcePath(baseNames) {
  for (const name of baseNames) {
    const p1 = path.join(__dirname, name);
    if (fs.existsSync(p1)) return p1;
    const p2 = path.join(__dirname, "cache", name);
    if (fs.existsSync(p2)) return p2;
  }
  throw new Error(`Файл не найден среди: ${baseNames.join(", ")}`);
}

const files = {
  easylist: findSourcePath(["easylist.txt"]),
  "adguard-ru": findSourcePath(["adguard_ru.txt", "ag.txt"]),
  easyprivacy: findSourcePath(["easyprivacy.txt"]),
};

try {
  const parsed = [];
  for (const [name, filePath] of Object.entries(files)) {
    const text = fs.readFileSync(filePath, "utf8");
    const p = sandbox.parseFilters(text);
    parsed.push({ name, ...p });
    console.log(`${name}: blocks=${p.blocks.length}, allows=${p.allows.length}`);
  }

  const dnr = sandbox.buildDnrRules(parsed);
  console.log("ИТОГО динамических DNR-правил (в рамках лимита):", dnr.length);

  // Валидность id и уникальность
  const ids = new Set(dnr.map((r) => r.id));
  console.log("уникальных id:", ids.size, "| дубликатов:", dnr.length - ids.size);
  if (ids.size !== dnr.length) throw new Error("Обнаружены дублирующиеся ID правил");

  const badAction = dnr.filter((r) => !r.action || !r.action.type);
  if (badAction.length > 0) throw new Error("Найдены правила без action");

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

  // Проверка правил Яндекс рекламы в ads_rules.json
  const adsRules = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "rules", "ads_rules.json"), "utf8"));
  const yandexRule = adsRules.find((r) => r.condition.urlFilter.includes("an.yandex.ru"));
  if (!yandexRule) throw new Error("Правило блокировки an.yandex.ru отсутствует в ads_rules.json");

  console.log("проверки парсера и структуры: пройдены успешно");
} catch (e) {
  console.error("ДВИЖОК УПАЛ:", e && e.stack ? e.stack : e);
  process.exit(1);
}
