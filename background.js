// AdGuardian — service worker (Manifest V3).
// DNR-правила живут между пробуждениями service worker. Поэтому никогда не
// пересобираем их на старте без необходимости: это экономит память и секунды CPU.
importScripts("lib/static-meta.js", "lib/filters.js");

const STATIC_RULESETS = ["ads_rules", "subscriptions"];
const UPDATE_ALARM = "refresh-subscriptions";
const UPDATE_PERIOD_MINUTES = 24 * 60;
const SITE_RULE_ID_START = 1;
const SITE_RULE_ID_END = 99999;
let updateTask = null;
let setupTask = null;

function normaliseHost(value) {
  try {
    if (typeof value !== "string") return "";
    const url = new URL(value.includes("://") ? value : `https://${value}`);
    return url.hostname.toLowerCase().replace(/^www\./, "");
  } catch (_) {
    return "";
  }
}

async function setStaticRulesets(enabled) {
  await chrome.declarativeNetRequest.updateEnabledRulesets(
    enabled
      ? { enableRulesetIds: STATIC_RULESETS }
      : { disableRulesetIds: STATIC_RULESETS }
  );
}

async function removeFilterRules() {
  const current = await chrome.declarativeNetRequest.getDynamicRules();
  const ids = current
    .filter((rule) => rule.id >= FILTER_RULE_ID_START)
    .map((rule) => rule.id);
  if (ids.length) await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: ids });
  await chrome.storage.local.set({ dynamicRulesReady: false });
}

async function rebuildAllowlist(force = false) {
  const { allowlist = [], allowlistAppliedKey = null } = await chrome.storage.local.get({ allowlist: [], allowlistAppliedKey: null });
  const hosts = [...new Set(allowlist.map(normaliseHost).filter(Boolean))];
  const appliedKey = hosts.join("|");
  if (!force && appliedKey === allowlistAppliedKey) return hosts;
  const current = await chrome.declarativeNetRequest.getDynamicRules();
  const removeRuleIds = current
    .filter((rule) => rule.id >= SITE_RULE_ID_START && rule.id <= SITE_RULE_ID_END)
    .map((rule) => rule.id);
  const addRules = hosts.map((host, index) => ({
    id: SITE_RULE_ID_START + index,
    priority: 100,
    action: { type: "allowAllRequests" },
    condition: {
      requestDomains: [host],
      resourceTypes: ["main_frame", "sub_frame"],
    },
  }));
  if (removeRuleIds.length || addRules.length) {
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules });
  }
  await chrome.storage.local.set({ allowlistAppliedKey: appliedKey });
  return hosts;
}

async function ensureFilters() {
  const { enabled, dynamicRulesReady, filterRules = 0 } = await chrome.storage.local.get({ enabled: true, dynamicRulesReady: false, filterRules: 0 });
  if (!enabled) return 0;
  if (dynamicRulesReady) return filterRules;
  return applyCachedFilters();
}

async function runUpdate(force = false) {
  if (updateTask) return updateTask;
  updateTask = (async () => {
    const { filterUpdatedAt = 0 } = await chrome.storage.local.get({ filterUpdatedAt: 0 });
    if (!force && Date.now() - filterUpdatedAt < UPDATE_PERIOD_MINUTES * 60_000) return null;
    return refreshFilters();
  })();
  try {
    return await updateTask;
  } finally {
    updateTask = null;
  }
}

async function syncState() {
  const { enabled } = await chrome.storage.local.get({ enabled: true });
  await setStaticRulesets(enabled);
  if (!enabled) {
    await removeFilterRules();
    return;
  }
  await rebuildAllowlist();
  await ensureFilters();
}

async function setup() {
  if (setupTask) return setupTask;
  setupTask = (async () => {
    await chrome.alarms.create(UPDATE_ALARM, { periodInMinutes: UPDATE_PERIOD_MINUTES });
    try {
      await syncState();
      await runUpdate(false);
    } catch (error) {
      await chrome.storage.local.set({ lastUpdateError: String(error) });
    }
  })();
  try {
    await setupTask;
  } finally {
    setupTask = null;
  }
}

setup();

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === "install") {
    await chrome.storage.local.set({ enabled: true, allowlist: [] });
  }
  await setup();
});

chrome.runtime.onStartup.addListener(setup);
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === UPDATE_ALARM) runUpdate(false).catch(() => {});
});

// `onRuleMatchedDebug` доступен только для распакованного расширения. Мы всё
// равно используем его при разработке, но записываем пачками — частые запросы
// больше не создают гонок записи в storage.local.
let pendingMatches = [];
let flushMatchesTimer = null;
let statsVersion = 0;
let statsWriteTask = Promise.resolve();

function enqueueStatsWrite(task) {
  statsWriteTask = statsWriteTask.then(task, task);
  return statsWriteTask;
}

function queueMatch(info) {
  let host = "?";
  try { host = new URL(info.request.url).hostname; } catch (_) {}
  // Не сохраняем полный URL: в нём могут быть поисковые запросы, токены и
  // другие персональные данные. Для статистики достаточно домена и типа.
  pendingMatches.push({ host, type: info.request.type || "resource", at: Date.now() });
  if (!flushMatchesTimer) flushMatchesTimer = setTimeout(() => flushMatches().catch(() => {}), 750);
}

async function flushMatches() {
  flushMatchesTimer = null;
  const batch = pendingMatches;
  const version = statsVersion;
  pendingMatches = [];
  if (!batch.length) return;
  return enqueueStatsWrite(async () => {
    const data = await chrome.storage.local.get({ blockedTotal: 0, blockedByDomain: {}, lastBlocked: [] });
    if (version !== statsVersion) return;
    data.blockedTotal += batch.length;
    for (const item of batch) data.blockedByDomain[item.host] = (data.blockedByDomain[item.host] || 0) + 1;
    data.lastBlocked.unshift(...batch.reverse());
    data.lastBlocked.length = Math.min(data.lastBlocked.length, 100);
    await chrome.storage.local.set(data);
  });
}

chrome.declarativeNetRequest.onRuleMatchedDebug?.addListener(queueMatch);

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab || null;
}

async function getDashboard() {
  const [data, tab] = await Promise.all([
    chrome.storage.local.get({
      enabled: true, allowlist: [], blockedTotal: 0,
      filterRules: 0, filterUpdatedAt: 0, lastUpdateError: "",
    }),
    getActiveTab(),
  ]);
  const host = tab && tab.url ? normaliseHost(tab.url) : "";
  return {
    ...data,
    staticRules: data.enabled ? Number(globalThis.STATIC_SUBSCRIPTION_RULES || 0) + Number(globalThis.STATIC_BUILTIN_RULES || 0) : 0,
    totalRules: data.enabled ? Number(globalThis.STATIC_SUBSCRIPTION_RULES || 0) + Number(globalThis.STATIC_BUILTIN_RULES || 0) + Number(data.filterRules || 0) : 0,
    site: host,
    isSiteAllowed: Boolean(host && data.allowlist.includes(host)),
    isWebPage: Boolean(host && /^https?:/i.test(tab.url)),
  };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg.type === "toggle") {
      const enabled = Boolean(msg.enabled);
      if (enabled) {
        await chrome.storage.local.set({ enabled: true });
        await setStaticRulesets(true);
        await rebuildAllowlist();
        await ensureFilters();
        await runUpdate(false);
      } else {
        await removeFilterRules();
        await setStaticRulesets(false);
        await chrome.storage.local.set({ enabled: false });
      }
      return { ok: true, enabled };
    }

    if (msg.type === "getDashboard" || msg.type === "getState") return getDashboard();

    if (msg.type === "setSiteAllowed") {
      const host = normaliseHost(msg.host);
      if (!host) throw new Error("Не удалось определить адрес сайта");
      const { allowlist = [] } = await chrome.storage.local.get({ allowlist: [] });
      const next = new Set(allowlist.map(normaliseHost).filter(Boolean));
      if (msg.allowed) next.add(host); else next.delete(host);
      await chrome.storage.local.set({ allowlist: [...next].sort() });
      await rebuildAllowlist();
      return { ok: true, allowed: Boolean(msg.allowed) };
    }

    if (msg.type === "getCosmeticState") {
      const { enabled, allowlist } = await chrome.storage.local.get({ enabled: true, allowlist: [] });
      const host = normaliseHost(sender.tab && sender.tab.url ? sender.tab.url : "");
      return { enabled, allowed: Boolean(host && allowlist.includes(host)) };
    }

    if (msg.type === "resetStats") {
      statsVersion++;
      pendingMatches = [];
      await enqueueStatsWrite(() => chrome.storage.local.set({ blockedTotal: 0, blockedByDomain: {}, lastBlocked: [] }));
      return { ok: true };
    }

    if (msg.type === "checkUpdates") {
      const rules = await runUpdate(true);
      return { ok: true, rules: rules || 0 };
    }

    if (msg.type === "getTabMatches") {
      const tab = await getActiveTab();
      if (!tab || !tab.id) return { count: 0 };
      const result = await chrome.declarativeNetRequest.getMatchedRules({ tabId: tab.id });
      return { count: result.rulesMatchedInfo.length };
    }

    return { ok: false, error: "Неизвестная команда" };
  })().then(sendResponse, (error) => sendResponse({ ok: false, error: String(error.message || error) }));
  return true;
});
