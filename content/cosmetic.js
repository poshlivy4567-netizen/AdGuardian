// Лёгкая косметическая фильтрация для стандартных рекламных контейнеров.
// Мы намеренно используем только устойчивые признаки рекламных SDK, а не
// агрессивные эвристики по словам «ad»/«promo», чтобы не скрывать контент сайта.
(() => {
  "use strict";

  const HIDDEN_CLASS = "adguardian-cosmetic-hidden";
  const STYLE_ID = "adguardian-cosmetic-style";
  const SELECTOR = [
    "ins.adsbygoogle",
    "[data-ad-client]",
    "[data-ad-slot]",
    "[data-ad-format]",
    "[data-google-query-id]",
    "[data-ad-unit]",
    "iframe[id^='google_ads_iframe']",
    "iframe[name^='google_ads_iframe']",
    "iframe[id^='aswift_']",
    "[id^='yandex_rtb']",
    "[id^='yandex_ad']",
    "[class*='yandex_rtb']",
    "[class*='adfox']",
    "[data-adfox]",
    "iframe[src*='adfox']",
    "amp-ad",
    "amp-embed[type='adsense']",
  ].join(",");

  let state = { enabled: true, cosmeticEnabled: true, allowed: false };
  let scanScheduled = false;

  function shouldHide() {
    return state.enabled && state.cosmeticEnabled && !state.allowed;
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `.${HIDDEN_CLASS}{display:none !important;}`;
    (document.head || document.documentElement).appendChild(style);
  }

  function hide(element) {
    if (element instanceof Element) element.classList.add(HIDDEN_CLASS);
  }

  function scan(root = document) {
    if (!shouldHide()) return;
    ensureStyle();
    if (root instanceof Element && root.matches(SELECTOR)) hide(root);
    if (root.querySelectorAll) root.querySelectorAll(SELECTOR).forEach(hide);
  }

  function restore() {
    document.querySelectorAll(`.${HIDDEN_CLASS}`).forEach((element) => element.classList.remove(HIDDEN_CLASS));
  }

  function applyState() {
    if (shouldHide()) scan();
    else restore();
  }

  function scheduleScan(nodes) {
    if (!shouldHide() || scanScheduled) return;
    scanScheduled = true;
    requestAnimationFrame(() => {
      scanScheduled = false;
      for (const node of nodes) scan(node);
    });
  }

  function loadState() {
    chrome.runtime.sendMessage({ type: "getCosmeticState" }, (response) => {
      if (chrome.runtime.lastError || !response) return;
      state = response;
      applyState();
    });
  }

  const observer = new MutationObserver((records) => {
    const added = [];
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE || node.nodeType === Node.DOCUMENT_FRAGMENT_NODE) added.push(node);
      }
    }
    if (added.length) scheduleScan(added);
  });
  observer.observe(document, { childList: true, subtree: true });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && (changes.enabled || changes.cosmeticEnabled || changes.allowlist)) loadState();
  });

  loadState();
})();
