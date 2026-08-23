// Выполняется в MAIN world до кода страницы. Закрытый Shadow DOM нельзя читать
// из content script, но attachShadow возвращает root вызывающему коду. Мы
// используем это короткое окно только для проверяемых признаков рекламы и
// скрываем внешний host, не вмешиваясь в обычные Web Components.
(() => {
  "use strict";

  const STATE_ATTRIBUTE = "data-adguardian-cosmetic";
  const HIDDEN_CLASS = "adguardian-shadow-ad-hidden";
  const MAX_WATCHED = 64;

  // Определяется ДО первого использования (раньше стоял ниже — ReferenceError).
  const YANDEX_SUFFIXES = [
    "yandex.ru", "ya.ru", "dzen.ru", "yandex.by", "yandex.kz", "yandex.uz",
    "yandex.com", "yandex.com.tr", "yandex.eu", "yandex.fr", "yandex.net",
  ];
  const isYandex = YANDEX_SUFFIXES.some((suffix) => {
    const host = location.hostname;
    return host === suffix || host.endsWith(`.${suffix}`);
  });

  const AD_MARKER = [
    "ins.adsbygoogle", ".adsbygoogle", "[data-ad-client]", "[data-ad-slot]", "[data-ad-unit]",
    "[data-adfox]", "[id^='google_ads_iframe']", "[id^='aswift_']",
    "[id^='yandex_rtb']", "[id^='yandex_ad']",
    "iframe[src*='doubleclick.net']", "iframe[src*='googlesyndication.com']",
    "iframe[src*='adfox']", "iframe[src*='taboola.com']",
  ].join(",");
  // Маркеры РСЯ встречаются только на доменах Яндекса; на остальных сайтах
  // подстрока "R-I-" может случайно совпасть с id постороннего компонента.
  const YANDEX_AD_MARKER = [
    "[id*='R-I-']", "a[href*='an.yandex.ru/count']", "a[href*='yandex.ru/an/count']",
  ].join(",");
  const CONTENT_MARKER = isYandex ? `${AD_MARKER},${YANDEX_AD_MARKER}` : AD_MARKER;
  const GENERIC_HOST_SELECTOR = [
    "[data-ad-client]", "[data-ad-slot]", "[data-ad-unit]", "[data-adfox]",
    "[id^='google_ads_iframe']", "[id^='aswift_']", "[id^='yandex_rtb']", "[id^='yandex_ad']",
  ].join(",");
  const DIRECT_HOST_SELECTOR = isYandex
    ? `${GENERIC_HOST_SELECTOR}, [class*='yandex_rtb'], [id*='R-I-']`
    : GENERIC_HOST_SELECTOR;

  // host -> { root, rootObserver, styleObserver, hidden }
  const watched = new Map();
  let dirtyHosts = null;
  let frameScheduled = false;

  function enabled() {
    return document.documentElement?.getAttribute(STATE_ATTRIBUTE) !== "off";
  }

  function releaseGameLock() {
    document.body?.classList.remove("main-body_modal_yes", "main-body_scroll-hidden_yes");
  }

  function enforceHidden(host) {
    if (!host.classList.contains(HIDDEN_CLASS)) host.classList.add(HIDDEN_CLASS);
    if (
      host.style.getPropertyValue("display") !== "none" ||
      host.style.getPropertyPriority("display") !== "important"
    ) host.style.setProperty("display", "none", "important");
  }

  function stopRootObserver(host) {
    const entry = watched.get(host);
    if (entry?.rootObserver) {
      entry.rootObserver.disconnect();
      entry.rootObserver = null;
    }
  }

  function hide(host) {
    const entry = watched.get(host);
    if (!entry || entry.hidden) return;
    entry.hidden = {
      display: host.style.getPropertyValue("display"),
      priority: host.style.getPropertyPriority("display"),
    };
    enforceHidden(host);
    releaseGameLock();
    if (!entry.styleObserver) {
      entry.styleObserver = new MutationObserver(() => {
        if (entry.hidden && enabled()) enforceHidden(host);
      });
      entry.styleObserver.observe(host, { attributes: true, attributeFilter: ["style", "class"] });
    }
    stopRootObserver(host);
  }

  function restoreHost(host, entry) {
    if (!entry.hidden) return;
    host.classList.remove(HIDDEN_CLASS);
    if (entry.hidden.display) host.style.setProperty("display", entry.hidden.display, entry.hidden.priority);
    else host.style.removeProperty("display");
    entry.hidden = null;
    entry.styleObserver?.disconnect();
    entry.styleObserver = null;
  }

  function inspect(host, root) {
    const entry = watched.get(host);
    if (!entry || !enabled() || entry.hidden) return Boolean(entry?.hidden);
    if (host.matches(DIRECT_HOST_SELECTOR) || root.querySelector?.(CONTENT_MARKER)) {
      hide(host);
      return true;
    }
    return false;
  }

  function startRootObserver(host) {
    const entry = watched.get(host);
    if (!entry || entry.rootObserver || entry.hidden || !enabled()) return;
    entry.rootObserver = new MutationObserver(() => markDirty(host));
    entry.rootObserver.observe(entry.root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "id", "src", "data-ad-client", "data-ad-slot", "data-ad-unit", "data-adfox"],
    });
  }

  function markDirty(host) {
    (dirtyHosts ||= new Set()).add(host);
    if (frameScheduled) return;
    frameScheduled = true;
    requestAnimationFrame(() => {
      frameScheduled = false;
      const batch = dirtyHosts;
      dirtyHosts = null;
      if (!batch || !enabled()) return;
      for (const dirtyHost of batch) {
        const entry = watched.get(dirtyHost);
        if (entry && !inspect(dirtyHost, entry.root)) startRootObserver(dirtyHost);
      }
    });
  }

  function watch(host, root) {
    if (watched.has(host) || watched.size >= MAX_WATCHED) return;
    watched.set(host, { root, rootObserver: null, styleObserver: null, hidden: null });
    if (!inspect(host, root)) startRootObserver(host);
  }

  function suspend() {
    for (const [host, entry] of watched) {
      stopRootObserver(host);
      restoreHost(host, entry);
    }
  }

  function resume() {
    for (const [host, entry] of watched) {
      if (!inspect(host, entry.root)) startRootObserver(host);
    }
  }

  const originalAttachShadow = Element.prototype.attachShadow;
  if (typeof originalAttachShadow === "function") {
    Object.defineProperty(Element.prototype, "attachShadow", {
      configurable: true,
      writable: true,
      value(init) {
        const root = Reflect.apply(originalAttachShadow, this, [init]);
        try {
          if (init?.mode === "closed") watch(this, root);
        } catch (_) { /* не мешаем странице из-за сбоя фильтрации */ }
        return root;
      },
    });
  }

  // Всплывающие окна и popunder. Сетевой слой DNR блокирует переход на домен
  // рекламы, но окно при этом всё равно открывается с ошибкой. Здесь мы
  // откатываем сам window.open для известных popunder-сетей: окно не появляется
  // вовсе. Список намеренно короткий и состоит только из бесспорных рекламных
  // доменов, чтобы не задеть OAuth и обычные всплывающие окна сайтов.
  const POPUP_AD_HOSTS = [
    "adcash.com", "admaven.com", "adskeeper.com", "adskeeper.co.uk",
    "adsterra.com", "adsterranetwork.com", "clickadu.com", "directrev.com",
    "exoclick.com", "exosrv.com", "hilltopads.net", "juicyads.com",
    "mgid.com", "onclickads.net", "popads.net", "popcash.net",
    "popmyads.com", "popunder.net", "propellerads.com", "propellerclick.com",
    "realsrv.com", "trafficfactory.biz", "trafficjunky.com", "tsyndicate.com",
    "zeropark.com",
  ];
  const originalOpen = window.open;
  if (typeof originalOpen === "function") {
    window.open = function open(url, ...rest) {
      if (enabled() && typeof url === "string" && url) {
        try {
          const hostname = new URL(url, location.href).hostname;
          const isAdHost = POPUP_AD_HOSTS.some((ad) => hostname === ad || hostname.endsWith(`.${ad}`));
          // Дешёвые рекламные TLD (.bid и т.п.) используются сетями popunder
          // для ротации: ajNNNN.bid и подобные. Отсекаем до навигации.
          const isAdTld = hostname.endsWith(".bid");
          if (hostname && (isAdHost || isAdTld)) return null;
        } catch (_) { /* не абсолютный URL — пропускаем как есть */ }
      }
      return Reflect.apply(originalOpen, this, [url, ...rest]);
    };
  }

  try {
    new MutationObserver(() => {
      if (enabled()) resume();
      else suspend();
    }).observe(document.documentElement, { attributes: true, attributeFilter: [STATE_ATTRIBUTE] });
  } catch (_) { /* documentElement может отсутствовать в редких окружениях */ }
})();
