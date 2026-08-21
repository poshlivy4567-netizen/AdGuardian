// AdGuardian — загрузка и перевод подписок в безопасные DNR-правила.
// Этот файл подключается из service worker через importScripts и не использует
// модули, чтобы его можно было проверить обычным Node.js-скриптом.

const FILTER_SOURCES = [
  { name: "easylist", url: "https://easylist.to/easylist/easylist.txt" },
  { name: "adguard-ru", url: "https://filters.adtidy.org/extension/ublock/filters/1_optimized.txt" },
  { name: "easyprivacy", url: "https://easylist.to/easylist/easyprivacy.txt" },
];

const FILTER_RULE_ID_START = 100000;
const MAX_FILTER_RULES = 28000;
const MAX_DYNAMIC_RULES = 30000;
// 29 500 + 32 ручных правила = 29 532 ≤ гарантированных Chrome 30 000.
const MAX_STATIC_SUBSCRIPTION_RULES = 29500;
const STATIC_TRACKER_QUOTA = 12000;
const DYNAMIC_TRACKER_QUOTA = 10000;
// $popup-правила блокируют навигацию всплывающего окна (main_frame). Доменные
// правила точнее паттернов, поэтому идут первыми в срезе.
const STATIC_POPUP_QUOTA = 1000;
const DYNAMIC_POPUP_QUOTA = 1000;
const FETCH_TIMEOUT_MS = 30000;
const MAX_FILTER_LENGTH = 2000;
const MIN_SOURCE_BLOCKS = 100;

const RESOURCE_TYPE_MAP = {
  script: "script",
  image: "image",
  media: "media",
  subdocument: "sub_frame",
  frame: "sub_frame",
  document: "main_frame",
  stylesheet: "stylesheet",
  font: "font",
  object: "object",
  object_subrequest: "object",
  xmlhttprequest: "xmlhttprequest",
  ping: "ping",
  other: "other",
  websocket: "websocket",
  csp_report: "csp_report",
};

function splitOptions(line) {
  if (!line.includes("$") || line.startsWith("/")) return [line, ""];
  const index = line.lastIndexOf("$");
  return [line.slice(0, index), line.slice(index + 1)];
}

function isCosmeticRule(line) {
  return /#(?:@|\?|\$|%|@\$|@%)?#/.test(line);
}

function patternToUrlFilter(pattern) {
  if (pattern.startsWith("|") && pattern.endsWith("|") && pattern.length > 2) {
    return pattern.slice(1, -1);
  }
  return pattern;
}

function ruleKey(rule) {
  const c = rule.condition;
  return [
    c.urlFilter,
    rule.action.type,
    rule.priority,
    c.domainType || "",
    c.isUrlFilterCaseSensitive ? "case" : "",
    (c.domains || []).join(","),
    (c.excludedDomains || []).join(","),
    (c.resourceTypes || []).join(","),
    (c.excludedResourceTypes || []).join(","),
  ].join("|");
}

function pushUnique(list, value) {
  if (!list.includes(value)) list.push(value);
}

// ABP/uBO network rule -> DNR rule. Непереводимые модификаторы пропускаем:
// неверный «примерный» перевод опаснее, чем одно неиспользованное правило.
function convertNetworkRule(body, isException, optionsText) {
  const urlFilter = patternToUrlFilter(body);
  if (!urlFilter || urlFilter.length > MAX_FILTER_LENGTH) return null;
  // Chrome DNR принимает в urlFilter только ASCII. ABP-списки иногда содержат
  // международные домены в Unicode (например, .рф); такой фильтр сделал бы
  // невалидным весь статический ruleset, поэтому безопасно пропускаем его.
  if (/[^\x00-\x7F]/.test(urlFilter)) return null;

  const condition = { urlFilter };
  let important = false;
  let domainType = "";
  let popup = false;
  const domains = [];
  const excludedDomains = [];
  const resourceTypes = [];
  const excludedResourceTypes = [];
  let documentException = false;

  if (optionsText) {
    for (const rawOption of optionsText.split(",")) {
      const option = rawOption.trim();
      if (!option) continue;
      const negated = option.startsWith("~");
      const normalized = (negated ? option.slice(1) : option).toLowerCase();
      const eq = normalized.indexOf("=");
      const key = eq === -1 ? normalized : normalized.slice(0, eq);
      const value = eq === -1 ? "" : option.slice((negated ? 1 : 0) + eq + 1);

      if (key === "popup") {
        // В ABP $popup относится к URL открываемого окна, то есть к навигации
        // верхнего уровня. Исключения $popup зависят от инициатора и целевого
        // окна одновременно и безопасного перевода в DNR не имеют.
        if (negated || isException || popup) return null;
        popup = true;
        continue;
      }

      if (key === "domain") {
        for (const rawDomain of value.split("|")) {
          const domain = rawDomain.trim().toLowerCase();
          if (!domain) continue;
          if (domain.startsWith("~")) pushUnique(excludedDomains, domain.slice(1));
          else pushUnique(domains, domain);
        }
        continue;
      }
      if (key === "third-party" || key === "first-party") {
        const wanted = negated
          ? (key === "third-party" ? "firstParty" : "thirdParty")
          : (key === "third-party" ? "thirdParty" : "firstParty");
        if (domainType && domainType !== wanted) return null;
        domainType = wanted;
        continue;
      }
      if (key === "match-case") {
        if (negated) return null;
        condition.isUrlFilterCaseSensitive = true;
        continue;
      }
      if (key === "important") {
        if (negated) return null;
        important = true;
        continue;
      }
      if (key === "badfilter") return null;
      if (RESOURCE_TYPE_MAP[key]) {
        pushUnique(negated ? excludedResourceTypes : resourceTypes, RESOURCE_TYPE_MAP[key]);
        if (key === "document" && isException && !negated) documentException = true;
        continue;
      }

      // Это косметические/HTML-модификаторы, перенаправления и прочие действия,
      // которые DNR не может корректно выразить как сетевую блокировку.
      return null;
    }
  }

  if (popup && (resourceTypes.length || excludedResourceTypes.length)) return null;
  if (domains.length > 500 || excludedDomains.length > 500) return null;
  if (resourceTypes.length && excludedResourceTypes.length) {
    const overlap = resourceTypes.some((type) => excludedResourceTypes.includes(type));
    if (overlap) return null;
  }
  // Chrome разрешает allowAllRequests только для навигаций фреймов. Сложные
  // ABP-исключения с $document и другими типами безопаснее пропустить, чем
  // сделать весь ruleset невалидным.
  if (documentException && (
    excludedResourceTypes.length ||
    resourceTypes.some((type) => type !== "main_frame" && type !== "sub_frame")
  )) return null;
  if (domainType) condition.domainType = domainType;
  if (domains.length) condition.domains = domains;
  if (excludedDomains.length) condition.excludedDomains = excludedDomains;
  if (popup) condition.resourceTypes = ["main_frame"];
  else if (resourceTypes.length) condition.resourceTypes = resourceTypes;
  if (excludedResourceTypes.length) condition.excludedResourceTypes = excludedResourceTypes;

  return {
    priority: important && !isException ? 3 : (isException ? 2 : 1),
    // В ABP исключение с $document выключает сетевую фильтрацию для всей
    // иерархии документа. В DNR ему соответствует allowAllRequests, а не
    // обычный allow только для самого запроса навигации.
    action: { type: isException ? (documentException ? "allowAllRequests" : "allow") : "block" },
    condition,
  };
}

function parseFilters(text) {
  const blocks = [];
  const allows = [];
  const seen = new Set();

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("!") || line.startsWith("[")) continue;
    if (isCosmeticRule(line)) continue;
    if (line.startsWith("/") && line.lastIndexOf("/") > 0) continue;

    let [body, options] = splitOptions(line);
    const isException = body.startsWith("@@");
    if (isException) body = body.slice(2);
    if (!body || (body.startsWith("/") && body.lastIndexOf("/") > 0)) continue;

    const rule = convertNetworkRule(body, isException, options);
    if (!rule) continue;
    const key = ruleKey(rule);
    if (seen.has(key)) continue;
    seen.add(key);
    (isException ? allows : blocks).push(rule);
  }
  return { blocks, allows };
}

// Правило, блокирующее навигацию верхнего уровня (перевод $popup). Такие
// правила останавливают всплывающие окна и popunder до загрузки сайта рекламы.
function isTopLevelBlock(rule) {
  return rule.action.type === "block"
    && rule.condition.resourceTypes
    && rule.condition.resourceTypes.length === 1
    && rule.condition.resourceTypes[0] === "main_frame";
}

function groupLists(lists) {
  const groups = { priority: [], popup: [], tracker: [], generic: [], allows: [] };
  for (const list of lists) {
    groups.allows.push(...(list.allows || []));
    if (list.name === "adguard-ru") groups.priority.push(...(list.blocks || []));
    else if (list.name === "easyprivacy") groups.tracker.push(...(list.blocks || []));
    else {
      for (const rule of list.blocks || []) {
        (isTopLevelBlock(rule) ? groups.popup : groups.generic).push(rule);
      }
    }
  }
  // Sort стабилен: внутри групп исходный порядок подписки сохраняется.
  // Доменные правила (||host^) точнее паттернов, поэтому забирают квоту первыми.
  groups.popup.sort((a, b) =>
    Number(b.condition.urlFilter.startsWith("||")) - Number(a.condition.urlFilter.startsWith("||"))
  );
  return groups;
}

function createRuleBuilder(limit, startId) {
  const rules = [];
  const used = new Set();
  const tryAdd = (rule) => {
    const key = ruleKey(rule);
    if (used.has(key)) return false;
    used.add(key);
    if (rules.length >= limit) return false;
    rules.push({ id: startId + rules.length, ...rule });
    return true;
  };
  return { rules, used, tryAdd };
}

// Возвращает число реально занятых уникальных правил. Правила, пропущенные из-за
// смещения, всё равно помечаются как использованные: это сохраняет стабильную
// дедупликацию между приоритетными списками.
function addSlice(builder, source, skip = 0, take = Infinity) {
  let passed = 0;
  let added = 0;
  for (const rule of source) {
    const key = ruleKey(rule);
    if (builder.used.has(key)) continue;
    builder.used.add(key);
    if (passed++ < skip) continue;
    if (added >= take || builder.rules.length >= builder.limit) continue;
    builder.rules.push({ id: builder.startId + builder.rules.length, ...rule });
    added++;
  }
  return added;
}

function addAllows(builder, allows) {
  for (const rule of allows) builder.tryAdd(rule);
}

// Встроенный ruleset даёт мгновенную защиту без сети. Его баланс — региональные
// правила, всплывающие окна, 12k трекеров, затем максимум правил рекламы.
function buildSubscriptionRules(lists) {
  const groups = groupLists(lists);
  const builder = createRuleBuilder(MAX_STATIC_SUBSCRIPTION_RULES, 1);
  builder.limit = MAX_STATIC_SUBSCRIPTION_RULES;
  builder.startId = 1;
  addAllows(builder, groups.allows);
  addSlice(builder, groups.priority);
  const popupBlocks = addSlice(builder, groups.popup, 0, STATIC_POPUP_QUOTA);
  const trackerBlocks = addSlice(builder, groups.tracker, 0, STATIC_TRACKER_QUOTA);
  const genericBlocks = addSlice(builder, groups.generic, 0, MAX_STATIC_SUBSCRIPTION_RULES - builder.rules.length);
  return {
    rules: builder.rules,
    meta: { staticPopupBlocks: popupBlocks, staticTrackerBlocks: trackerBlocks, staticGenericBlocks: genericBlocks },
  };
}

// Динамический слой берёт свежие правила вне упакованного среза: это почти
// удваивает покрытие, сохраняя место для whitelist пользователя.
function buildDnrRules(lists, maxRules = MAX_FILTER_RULES) {
  const groups = groupLists(lists);
  const limit = Math.max(0, Math.min(MAX_FILTER_RULES, maxRules));
  const builder = createRuleBuilder(limit, FILTER_RULE_ID_START);
  builder.limit = limit;
  builder.startId = FILTER_RULE_ID_START;
  addAllows(builder, groups.allows);
  addSlice(builder, groups.priority);
  addSlice(builder, groups.popup, Number(globalThis.STATIC_POPUP_BLOCKS || 0), DYNAMIC_POPUP_QUOTA);
  addSlice(builder, groups.tracker, Number(globalThis.STATIC_TRACKER_BLOCKS || STATIC_TRACKER_QUOTA), DYNAMIC_TRACKER_QUOTA);
  addSlice(builder, groups.generic, Number(globalThis.STATIC_GENERIC_BLOCKS || 0));
  return builder.rules;
}

async function fetchText(url) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(url, { signal: controller.signal, cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.text();
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

async function refreshFilters() {
  const { filters_cache: previous = {} } = await chrome.storage.local.get({ filters_cache: {} });
  const results = await Promise.allSettled(
    FILTER_SOURCES.map((source) => fetchText(source.url).then((text) => ({ name: source.name, text })))
  );

  const cache = {};
  const errors = [];
  let succeeded = 0;
  results.forEach((result, index) => {
    const name = FILTER_SOURCES[index].name;
    if (result.status === "fulfilled") {
      const parsed = parseFilters(result.value.text);
      // Сервер ошибки иногда отвечает HTML с HTTP 200. Не заменяем рабочий
      // кэш пустым или повреждённым списком, иначе защита внезапно ослабнет.
      if (parsed.blocks.length < MIN_SOURCE_BLOCKS) {
        if (previous[name]) cache[name] = previous[name];
        errors.push(`${name}: список содержит слишком мало сетевых правил`);
      } else {
        cache[name] = { text: result.value.text, updatedAt: Date.now() };
        succeeded++;
      }
    } else {
      if (previous[name]) cache[name] = previous[name];
      errors.push(`${name}: ${result.reason && result.reason.message ? result.reason.message : result.reason}`);
    }
  });
  if (!succeeded) throw new Error(`Не удалось обновить подписки: ${errors.join("; ")}`);

  await chrome.storage.local.set({ filters_cache: cache });
  const count = await applyCachedFilters();
  await chrome.storage.local.set({
    filterUpdatedAt: Date.now(),
    filterRules: count,
    lastUpdateError: errors.length ? errors.join("; ") : "",
  });
  return count;
}

async function applyCachedFilters() {
  const { enabled, filters_cache: cache = {}, filterRules = 0 } = await chrome.storage.local.get({
    enabled: true, filters_cache: {}, filterRules: 0,
  });
  if (!enabled) return filterRules;

  const parsed = [];
  for (const source of FILTER_SOURCES) {
    const cached = cache[source.name];
    if (cached && cached.text) parsed.push({ name: source.name, ...parseFilters(cached.text) });
  }
  if (!parsed.length) return 0;

  const current = await chrome.declarativeNetRequest.getDynamicRules();
  // Whitelist живёт в том же динамическом ruleset. Всегда оставляем для неё
  // место и не превышаем документированный лимит безопасных DNR-правил.
  const protectedRuleCount = current.filter((rule) => rule.id < FILTER_RULE_ID_START).length;
  const rules = buildDnrRules(parsed, MAX_DYNAMIC_RULES - protectedRuleCount);
  const removeRuleIds = current.filter((rule) => rule.id >= FILTER_RULE_ID_START).map((rule) => rule.id);
  await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules: rules });
  await chrome.storage.local.set({ filterRules: rules.length, dynamicRulesReady: true });
  return rules.length;
}
