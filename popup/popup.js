const $ = (id) => document.getElementById(id);
const app = $("app");
const toggle = $("toggle");
const cosmetic = $("cosmetic");
const checkUpdates = $("checkUpdates");
const siteToggle = $("siteToggle");
let dashboard = null;

function send(message) {
  return new Promise((resolve) => chrome.runtime.sendMessage(message, (response) => resolve(response || { ok: false })));
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString("ru-RU");
}

function formatDate(value) {
  if (!value) return "ещё не было";
  const elapsed = Date.now() - value;
  if (elapsed < 60_000) return "только что";
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)} мин. назад`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)} ч. назад`;
  return new Date(value).toLocaleDateString("ru-RU", { day: "2-digit", month: "short" });
}

function setNotice(text = "", kind = "") {
  const notice = $("notice");
  notice.textContent = text;
  notice.className = `notice ${kind}`;
}

function render(data) {
  dashboard = data;
  const enabled = Boolean(data.enabled);
  app.classList.toggle("is-off", !enabled);
  toggle.checked = enabled;
  cosmetic.checked = Boolean(data.cosmeticEnabled);
  $("stateText").textContent = enabled ? "Защита активна" : "Защита выключена";
  $("count").textContent = formatNumber(data.blockedTotal);
  $("rules").textContent = data.filterRules ? `${formatNumber(data.filterRules)} динамических` : "встроенные активны";
  $("updated").textContent = formatDate(data.filterUpdatedAt);

  const isSiteAllowed = Boolean(data.isSiteAllowed);
  siteToggle.disabled = !data.isWebPage;
  $("siteName").textContent = data.isWebPage ? data.site : "Не веб-страница";
  $("siteDescription").textContent = !data.isWebPage
    ? "Откройте обычный сайт, чтобы настроить исключение"
    : isSiteAllowed ? "Блокировка приостановлена для этого сайта" : "Блокировка и скрытие рекламы включены";
  siteToggle.textContent = isSiteAllowed ? "Включить" : "Пауза";
  siteToggle.classList.toggle("resume", isSiteAllowed);

  if (data.lastUpdateError) setNotice(`Часть подписок не обновилась: ${data.lastUpdateError}`, "warning");
}

async function load() {
  const data = await send({ type: "getDashboard" });
  if (data && data.ok !== false) render(data);
}

toggle.addEventListener("change", async () => {
  const desired = toggle.checked;
  toggle.disabled = true;
  setNotice(desired ? "Включаю защиту…" : "Выключаю защиту…");
  const result = await send({ type: "toggle", enabled: desired });
  toggle.disabled = false;
  if (!result.ok) {
    setNotice(`Не удалось изменить состояние: ${result.error || "ошибка браузера"}`, "error");
    toggle.checked = !desired;
    return;
  }
  setNotice("");
  await load();
});

siteToggle.addEventListener("click", async () => {
  if (!dashboard || !dashboard.isWebPage) return;
  siteToggle.disabled = true;
  const allow = !dashboard.isSiteAllowed;
  const result = await send({ type: "setSiteAllowed", host: dashboard.site, allowed: allow });
  siteToggle.disabled = false;
  if (!result.ok) setNotice(`Не удалось изменить правило сайта: ${result.error || "ошибка"}`, "error");
  else {
    setNotice(allow ? "Защита на сайте приостановлена. Обновите страницу." : "Защита сайта включена. Обновите страницу.", "success");
    await load();
  }
});

cosmetic.addEventListener("change", async () => {
  const result = await send({ type: "setCosmetic", enabled: cosmetic.checked });
  if (!result.ok) {
    cosmetic.checked = !cosmetic.checked;
    setNotice("Не удалось изменить косметическую фильтрацию", "error");
  } else {
    setNotice("Настройка применится сразу после обновления страницы.", "success");
  }
});

checkUpdates.addEventListener("click", async () => {
  checkUpdates.disabled = true;
  checkUpdates.textContent = "Обновляю…";
  setNotice("Скачиваю и проверяю подписки…");
  const result = await send({ type: "checkUpdates" });
  checkUpdates.disabled = false;
  checkUpdates.textContent = "Обновить фильтры";
  if (!result.ok) setNotice(`Обновление не выполнено: ${result.error || "нет ответа"}`, "error");
  else {
    setNotice(`Готово: ${formatNumber(result.rules)} свежих динамических правил.`, "success");
    await load();
  }
});

$("openStats").addEventListener("click", () => chrome.tabs.create({ url: chrome.runtime.getURL("stats/stats.html") }));
$("resetStats").addEventListener("click", async () => {
  await send({ type: "resetStats" });
  setNotice("Счётчик сброшен.", "success");
  await load();
});

chrome.storage.onChanged.addListener((_changes, area) => { if (area === "local") load(); });
load();
