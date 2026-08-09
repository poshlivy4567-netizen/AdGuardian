const $ = (id) => document.getElementById(id);

function number(value) { return Number(value || 0).toLocaleString("ru-RU"); }
function relativeDate(value) {
  if (!value) return "ещё не обновлялись";
  const minutes = Math.floor((Date.now() - value) / 60_000);
  if (minutes < 1) return "обновлены только что";
  if (minutes < 60) return `обновлены ${minutes} мин. назад`;
  if (minutes < 1440) return `обновлены ${Math.floor(minutes / 60)} ч. назад`;
  return `обновлены ${new Date(value).toLocaleDateString("ru-RU")}`;
}
function time(value) { return new Date(value).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" }); }
function empty(text) { const node = document.createElement("p"); node.className = "empty"; node.textContent = text; return node; }

function render(data) {
  $("total").textContent = number(data.blockedTotal);
  $("rules").textContent = number(data.filterRules);
  $("updated").textContent = relativeDate(data.filterUpdatedAt);
  $("allowlist").textContent = number((data.allowlist || []).length);

  const domains = $("domains");
  domains.replaceChildren();
  const entries = Object.entries(data.blockedByDomain || {}).sort((a, b) => b[1] - a[1]).slice(0, 10);
  if (!entries.length) {
    domains.append(empty("Пока нет записанных срабатываний."));
  } else {
    const max = entries[0][1];
    for (const [host, count] of entries) {
      const row = document.createElement("div"); row.className = "domain-row";
      const copy = document.createElement("div");
      const name = document.createElement("strong"); name.textContent = host;
      const track = document.createElement("span"); track.className = "track";
      const bar = document.createElement("span"); bar.className = "bar"; bar.style.width = `${Math.max(4, Math.round((count / max) * 100))}%`;
      track.append(bar); copy.append(name, track);
      const value = document.createElement("b"); value.textContent = number(count);
      row.append(copy, value); domains.append(row);
    }
  }

  const recent = $("recent");
  recent.replaceChildren();
  const records = (data.lastBlocked || []).slice(0, 25);
  if (!records.length) {
    recent.append(empty("Новые срабатывания появятся здесь автоматически."));
  } else {
    for (const record of records) {
      const row = document.createElement("div"); row.className = "recent-row";
      const clock = document.createElement("time"); clock.textContent = time(record.at);
      const host = document.createElement("strong"); host.textContent = record.host || "неизвестный домен";
      const type = document.createElement("span"); type.textContent = record.type || "запрос";
      row.append(clock, host, type); recent.append(row);
    }
  }
}

function load() {
  chrome.storage.local.get({ blockedTotal: 0, blockedByDomain: {}, lastBlocked: [], filterRules: 0, filterUpdatedAt: 0, allowlist: [] }, render);
}
chrome.storage.onChanged.addListener((_changes, area) => { if (area === "local") load(); });
$("reset").addEventListener("click", () => chrome.runtime.sendMessage({ type: "resetStats" }, load));
load();
