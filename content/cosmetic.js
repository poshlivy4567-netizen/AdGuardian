// Косметическая фильтрация известных рекламных контейнеров.
// Горячий путь (MutationObserver) делает только точечные проверки селектором;
// дорогой поиск открытых Shadow DOM вынесен в редкий фоновый обход.
(() => {
  "use strict";

  const HIDDEN_CLASS = "adguardian-cosmetic-hidden";
  const STYLE_ID = "adguardian-cosmetic-style";
  const STATE_ATTRIBUTE = "data-adguardian-cosmetic";

  // Универсальные селекторы, безопасные на любом сайте.
  const GENERIC_SELECTOR = [
    "ins.adsbygoogle", "[data-ad-client]", "[data-ad-slot]", "[data-ad-format]",
    "[data-google-query-id]", "[data-ad-unit]", "[data-ad-container]", "[data-advertisement]",
    "iframe[id^='google_ads_iframe']", "iframe[name^='google_ads_iframe']", "iframe[id^='aswift_']",
    "[id^='div-gpt-ad']", "iframe[src*='doubleclick.net']", "iframe[src*='googlesyndication.com']",
    "[id^='yandex_rtb']", "[id^='yandex_ad']", "[class*='yandex_rtb']", "[class*='adfox']",
    "[data-adfox]", "iframe[src*='adfox']", "amp-ad", "amp-embed[type='adsense']",
    ".OUTBRAIN", "[data-ob-widget]", "[id^='taboola-']", "iframe[src*='taboola.com']",
    "[id^='mgid_']", "[data-type='mgid']",

    // Яндекс Игры: внешний полноэкранный слой и его sticky-варианты.
    ".sticky-banner-container", "[class*='adv-sticky-banner-manager']",
    "[class*='yandex-sticky-adv-banner']", "#yandex-adv-sticky-banner-desktop",
    ".aab-adv", ".play-modal_yandex", ".play-yandex-rewarded_video",
    ".play-yandex-modal__wrap", "[class*='play-yandex-modal']",
  ].join(",");

  // Селекторы Яндекса из официальных подписок AdGuard (фильтр «Яндекс» и RU).
  // Применяем только на его доменах, чтобы не задевать другие сайты.
  const YANDEX_SUFFIXES = [
    "yandex.ru", "ya.ru", "dzen.ru", "yandex.by", "yandex.kz", "yandex.uz",
    "yandex.com", "yandex.com.tr", "yandex.eu", "yandex.fr", "yandex.net",
  ];
  const YANDEX_SELECTOR = [
    ".play-modal__inner",                          // контейнер полноэкранной рекламы Игр
    ".stack > div[class^='sticky-']",              // sticky-баннер в колонке сервисов
    ".sidebar-container div[id*='R-I-']",          // РСЯ в сайдбаре (внутри Shadow DOM)
    "div[id^='search-list-'][id*='-R-I-']",        // реклама в поисковой выдаче
    "div[class*='-DirectSkeleton']",               // заглушки Директа
    ".AdvSnippetFeature-Item",                     // промо-сниппеты выдачи
    ".AdvMastHead", ".AdvPremium-List",            // Яндекс.Картинки, Недвижимость
    ".main-home-banner",                           // баннер на главной (kz)
    "div[class^='MainPage_topBlockWithMoney_']",   // Погода
    "li[class^='AppForecastMoney_wrap_']", "article[class^='AppMoney_wrap_']",
  ].join(",");

  const GAME_MODAL_SELECTOR = ".aab-adv, .play-modal_yandex, .play-yandex-rewarded_video, [class*='play-yandex-modal'], .play-modal__inner";
  // Больше этого числа изменённых узлов за раз — дешевле один проход по документу.
  const WHOLE_DOCUMENT_THRESHOLD = 48;
  // Полный обход используется лишь после большой пачки DOM-изменений.
  const DEEP_SCAN_INTERVAL = 2000;
  // Не удерживаем тысячи удалённых карточек бесконечной ленты в памяти только
  // ради восстановления inline-стилей после выключения расширения.
  const MAX_RESTORABLE_ELEMENTS = 1200;
  const OBSERVED_ATTRIBUTES = [
    "class", "id", "src", "name", "data-ad-client", "data-ad-slot", "data-ad-format",
    "data-google-query-id", "data-ad-unit", "data-ad-container", "data-advertisement", "data-adfox",
  ];

  const host = location.hostname;
  const isYandex = YANDEX_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
  const SELECTOR = isYandex ? `${GENERIC_SELECTOR},${YANDEX_SELECTOR}` : GENERIC_SELECTOR;

  let state = { enabled: true, allowed: false };
  let observerActive = false;
  let scanScheduled = false;
  let deepScanTimer = null;
  let deepScanLast = 0;
  const observedRoots = new WeakSet();
  const styledRoots = new WeakSet();
  const roots = new Set([document]);
  const previousStyles = new Map();

  function shouldHide() {
    return state.enabled && !state.allowed;
  }

  function setMainWorldState() {
    if (document.documentElement) document.documentElement.setAttribute(STATE_ATTRIBUTE, shouldHide() ? "on" : "off");
  }

  // <style> с классом скрытия нужен только документу и найденным Shadow-корням;
  // в обычные просканированные узлы ничего не добавляем.
  function ensureStyle(root) {
    if (root !== document && !(root instanceof ShadowRoot)) return;
    if (styledRoots.has(root)) return;
    const parent = root === document ? (document.head || document.documentElement) : root;
    if (!parent) return; // на document_start документа может ещё не быть — попробуем позже
    styledRoots.add(root);
    if (root.querySelector && root.querySelector(`#${STYLE_ID}`)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `.${HIDDEN_CLASS}{display:none !important;visibility:hidden !important;pointer-events:none !important;}`;
    parent.appendChild(style);
  }

  function saveStyle(element) {
    if (previousStyles.has(element)) return true;
    if (previousStyles.size >= MAX_RESTORABLE_ELEMENTS) return false;
    previousStyles.set(element, {
      display: element.style.getPropertyValue("display"),
      displayPriority: element.style.getPropertyPriority("display"),
      visibility: element.style.getPropertyValue("visibility"),
      visibilityPriority: element.style.getPropertyPriority("visibility"),
      pointerEvents: element.style.getPropertyValue("pointer-events"),
      pointerEventsPriority: element.style.getPropertyPriority("pointer-events"),
    });
    return true;
  }

  function releaseGameLock() {
    if (!document.body) return;
    document.body.classList.remove("main-body_modal_yes", "main-body_scroll-hidden_yes");
  }

  function hide(element) {
    if (!(element instanceof Element) || element.classList.contains(HIDDEN_CLASS)) return;
    const canRestoreInlineStyle = saveStyle(element);
    element.classList.add(HIDDEN_CLASS);
    // Inline !important survives late stylesheets from the game application.
    // После лимита полагаемся на style в content script: это не удерживает
    // удалённые DOM-узлы в памяти и остаётся корректно обратимым.
    if (canRestoreInlineStyle) {
      element.style.setProperty("display", "none", "important");
      element.style.setProperty("visibility", "hidden", "important");
      element.style.setProperty("pointer-events", "none", "important");
    }
    if (element.matches(GAME_MODAL_SELECTOR)) releaseGameLock();
  }

  function restoreElement(element, previous) {
    element.classList.remove(HIDDEN_CLASS);
    for (const [property, value, priority] of [
      ["display", previous.display, previous.displayPriority],
      ["visibility", previous.visibility, previous.visibilityPriority],
      ["pointer-events", previous.pointerEvents, previous.pointerEventsPriority],
    ]) {
      if (value) element.style.setProperty(property, value, priority);
      else element.style.removeProperty(property);
    }
  }

  function observeRoot(root) {
    if (observedRoots.has(root)) return;
    observedRoots.add(root);
    roots.add(root);
    if (observerActive) observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: OBSERVED_ATTRIBUTES });
  }

  // Дешёвая точечная проверка: один запрос селектором по корню (или одному узлу).
  function scan(root = document) {
    if (!shouldHide()) return;
    ensureStyle(root);
    if (root instanceof Element && root.matches(SELECTOR)) hide(root);
    if (root.querySelectorAll) for (const element of root.querySelectorAll(SELECTOR)) hide(element);
  }

  // Поиск открытых Shadow DOM в новом поддереве. В отличие от полного обхода
  // документа, стоимость пропорциональна только что добавленным узлам.
  function discoverOpenShadowRoots(startRoot) {
    if (!shouldHide()) return;
    const queue = [startRoot];
    while (queue.length) {
      const root = queue.pop();
      if (!root.querySelectorAll) continue;
      const visit = (element) => {
        const shadow = element.shadowRoot;
        if (!shadow) return;
        observeRoot(shadow);
        scan(shadow);
        queue.push(shadow);
      };
      if (root instanceof Element) visit(root);
      for (const element of root.querySelectorAll("*")) visit(element);
    }
  }

  // Дорогой обход всего документа нужен только для первоначальной проверки и
  // крупных DOM-пакетов, когда точечный обход дороже.
  function deepScan() {
    ensureStyle(document);
    discoverOpenShadowRoots(document);
  }

  function scheduleDeepScan() {
    if (deepScanTimer || !shouldHide()) return;
    const wait = Math.max(0, DEEP_SCAN_INTERVAL - (Date.now() - deepScanLast));
    deepScanTimer = setTimeout(() => {
      deepScanTimer = null;
      deepScanLast = Date.now();
      deepScan();
    }, wait);
  }

  function restore() {
    for (const [element, previous] of previousStyles) restoreElement(element, previous);
    previousStyles.clear();
    // Элементы после лимита не получили inline-стили, поэтому их достаточно
    // освободить от служебного класса. Это также очищает уже отключённые узлы.
    for (const root of roots) {
      if (!root.querySelectorAll) continue;
      for (const element of root.querySelectorAll(`.${HIDDEN_CLASS}`)) element.classList.remove(HIDDEN_CLASS);
    }
  }

  function startObserver() {
    if (observerActive) return;
    observerActive = true;
    for (const root of roots) observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: OBSERVED_ATTRIBUTES });
  }

  function stopObserver() {
    observerActive = false;
    observer.disconnect();
  }

  function applyState() {
    setMainWorldState();
    if (shouldHide()) {
      startObserver();
      scan();
      deepScanLast = Date.now();
      deepScan();
    } else {
      stopObserver();
      restore();
    }
  }

  function scheduleScan(nodes) {
    if (!observerActive || scanScheduled) return;
    scanScheduled = true;
    requestAnimationFrame(() => {
      scanScheduled = false;
      if (!observerActive) return;
      if (nodes.length > WHOLE_DOCUMENT_THRESHOLD) {
        scan();
        scheduleDeepScan();
      } else {
        for (const node of nodes) {
          scan(node);
          discoverOpenShadowRoots(node);
        }
      }
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
    let changed = null;
    for (const record of records) {
      // Смена атрибута рекламного контейнера проверяется точечно: поддерево не трогаем.
      if (record.type === "attributes") {
        (changed ||= []).push(record.target);
        continue;
      }
      for (const node of record.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE || node.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
          (changed ||= []).push(node);
        }
      }
    }
    if (changed) scheduleScan(changed);
  });

  // Стартуем сразу с оптимистичным состоянием: реклама может появиться раньше,
  // чем service worker ответит со сохранённым состоянием. loadState уточнит.
  roots.add(document);
  applyState();
  loadState();

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && (changes.enabled || changes.allowlist)) loadState();
  });
})();
