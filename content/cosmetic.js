// AdGuardian — продвинутая косметическая фильтрация и нейтрализация рекламы.
// Блокирует sticky-баннеры, РСЯ (Яндекс Директ), AdFox, Google Ads и скрывает рекламные контейнеры.
(() => {
  "use strict";

  const HIDDEN_CLASS = "adguardian-cosmetic-hidden";
  const STYLE_ID = "adguardian-cosmetic-style";

  // Основной список селекторов рекламных контейнеров, sticky-баннеров и разметки Яндекса
  const AD_SELECTORS = [
    // --- Sticky-баннеры и адаптивные обёртки Яндекса ---
    ".yandex-sticky-adv-banner__desktop-wrapper",
    ".yandex-sticky-adv-banner__desktop-wrapper_with-disable-ad-button",
    ".yandex-sticky-adv-banner__mobile-wrapper",
    ".yandex-sticky-adv-banner",
    ".yandex-sticky-adv-banner_desktop_right",
    ".yandex-sticky-adv-banner_desktop_additional_right",
    ".yandex-sticky-adv-banner_hidden",
    ".yandex-sticky-adv-banner__spinner",
    "[id^='yandex-adv-sticky-banner']",
    "[id*='yandex-adv-sticky']",
    "[id^='yandex-adv-']",
    "[class*='yandex-sticky-adv-banner']",
    "[class*='yandex-sticky-adv-']",
    "[class*='yandex-adv-sticky']",
    "[class*='yandex-sticky-']",
    "[class*='spin-critical-module']",
    "[class*='csr-uniq']",
    "[data-name='adaptiveConstructorAd']",
    "[data-name='adWrapper']",
    "[data-name='adaptiveImageContainer']",
    "[data-name='adaptiveImageTransform']",
    "[data-name='adaptiveImage']",
    "[data-new-adtune]",
    "[data-sticky-adtune]",
    "[data-backpack-size]",
    "[data-block-name='arrow-button']",
    "[data-block-name='header']",
    "[data-block-name='image']",
    "[data-block-name='title']",
    "[elementtiming='tgo-ssr-image']",
    "[data-asset-click]",
    "[data-branding-keyword]",
    "[class*='adv-focusable']",

    // --- Яндекс РТБ, Директ, AdFox ---
    "[id^='yandex_rtb']",
    "[id*='yandex_rtb_']",
    "[id^='yandex_ad']",
    "[id*='yandex_ad_']",
    "[id^='ya_partner_']",
    "[id*='ya_partner_']",
    "[id^='yandex_direct_']",
    "[id*='yandex_direct']",
    "[class*='yandex_rtb']",
    "[class*='yandex_ad']",
    "[class*='yandex-rtb']",
    "[class*='yandex-direct']",
    "[class*='ya-partner']",
    "[class*='ya-site-form']",
    "[id^='adfox_']",
    "[class*='adfox']",
    "[data-adfox]",
    "iframe[src*='adfox.ru']",
    "iframe[src*='an.yandex.ru']",
    "iframe[src*='awaps.yandex.ru']",
    "iframe[src*='yandex.ru/ads']",
    "iframe[src*='yabs.yandex.ru']",

    // --- Общие Sticky и плавающие баннеры ---
    "[class*='sticky-banner']",
    "[class*='sticky_banner']",
    "[class*='sticky-adv']",
    "[class*='sticky_adv']",
    "[class*='sticky-ad']",
    "[class*='sticky_ad']",
    "[class*='banner-sticky']",
    "[class*='banner_sticky']",
    "[class*='bottom-sticky']",
    "[class*='top-sticky']",
    "[class*='side-sticky']",
    "[class*='left-sticky']",
    "[class*='right-sticky']",
    "[class*='floating-banner']",
    "[class*='floating-ad']",
    "[class*='floating_banner']",
    "[class*='floating_ad']",
    "[class*='fixed-banner']",
    "[class*='fixed-ad']",
    "[class*='banner-fixed']",
    "[class*='ad-fixed']",
    "[id*='sticky-banner']",
    "[id*='sticky_banner']",
    "[id*='sticky-adv']",
    "[id*='sticky_adv']",
    "[id*='sticky-ad']",
    "[id*='sticky_ad']",
    "[id*='floating-ad']",
    "[id*='floating-banner']",
    "[id*='fixed-banner']",
    "[id*='fixed-ad']",
    "[data-sticky-banner]",
    "[data-sticky-ad]",
    "[data-ad-sticky]",
    "[data-floating-banner]",
    "[data-floating-ad]",

    // --- Google Ads и другие рекламные платформы ---
    "ins.adsbygoogle",
    "[data-ad-client]",
    "[data-ad-slot]",
    "[data-ad-format]",
    "[data-google-query-id]",
    "[data-ad-unit]",
    "[data-ad-placeholder]",
    "iframe[id^='google_ads_iframe']",
    "iframe[name^='google_ads_iframe']",
    "iframe[id^='aswift_']",
    "amp-ad",
    "amp-embed[type='adsense']",
    "[class*='ad-banner']",
    "[class*='advertisement-container']"
  ];

  const COMBINED_SELECTOR = AD_SELECTORS.join(",");

  const CSS_RULES = `
    .${HIDDEN_CLASS},
    ${COMBINED_SELECTOR} {
      display: none !important;
      visibility: hidden !important;
      opacity: 0 !important;
      height: 0 !important;
      min-height: 0 !important;
      max-height: 0 !important;
      width: 0 !important;
      margin: 0 !important;
      padding: 0 !important;
      pointer-events: none !important;
      position: absolute !important;
      overflow: hidden !important;
      z-index: -99999 !important;
      clip: rect(0, 0, 0, 0) !important;
    }
  `;

  let state = { enabled: true, cosmeticEnabled: true, allowed: false };
  let scanScheduled = false;
  let defuserInjected = false;

  function shouldHide() {
    return state.enabled && state.cosmeticEnabled && !state.allowed;
  }

  // Внедрение нейтрализатора JS API Яндекс РСЯ и AdFox в контекст страницы (MAIN world)
  function injectDefuser() {
    if (defuserInjected || !shouldHide()) return;
    defuserInjected = true;

    try {
      const script = document.createElement("script");
      script.textContent = `(${(() => {
        const noop = () => {};
        const noopPromise = () => Promise.resolve();

        const cleanElement = (target) => {
          if (!target) return;
          try {
            const el = typeof target === "string"
              ? (document.getElementById(target) || document.querySelector(target))
              : target;
            if (el) {
              el.innerHTML = "";
              el.style.setProperty("display", "none", "important");
              el.style.setProperty("height", "0", "important");
              el.style.setProperty("margin", "0", "important");
              el.style.setProperty("padding", "0", "important");
            }
          } catch (_) {}
        };

        // Защита и перехват yaContextCb
        window.yaContextCb = window.yaContextCb || [];
        const originalPush = window.yaContextCb.push.bind(window.yaContextCb);
        window.yaContextCb.push = function (...items) {
          for (const item of items) {
            if (typeof item === "function") {
              try { item(); } catch (_) {}
            }
          }
          return window.yaContextCb.length;
        };

        // Заглушка Ya.Context.AdvManager
        window.Ya = window.Ya || {};
        window.Ya.Context = window.Ya.Context || {};
        window.Ya.Context.AdvManager = {
          render: (params) => {
            if (params && params.renderTo) cleanElement(params.renderTo);
            return noopPromise();
          },
          destroy: noop,
        };

        // Заглушка AdFox
        window.Ya.adfoxCode = {
          create: (params) => { if (params) cleanElement(params.containerId || params.pr); },
          createAdaptive: (params) => { if (params) cleanElement(params.containerId); },
          createScroll: (params) => { if (params) cleanElement(params.containerId); },
          clearSession: noop,
          destroy: noop,
          reload: noop,
        };
        window.adfoxCode = window.Ya.adfoxCode;
        window.Ya.adfox = window.Ya.adfoxCode;
      }).toString()})();`;

      (document.head || document.documentElement).appendChild(script);
      script.remove();
    } catch (_) {}
  }

  function ensureStyle() {
    let style = document.getElementById(STYLE_ID);
    if (!style) {
      style = document.createElement("style");
      style.id = STYLE_ID;
      style.textContent = CSS_RULES;
      (document.head || document.documentElement).appendChild(style);
    }
  }

  function removeStyle() {
    const style = document.getElementById(STYLE_ID);
    if (style) style.remove();
  }

  function hideElement(element) {
    if (!element || !(element instanceof Element)) return;
    element.classList.add(HIDDEN_CLASS);
    element.style.setProperty("display", "none", "important");
    element.style.setProperty("height", "0", "important");
    element.style.setProperty("min-height", "0", "important");
    element.style.setProperty("margin", "0", "important");
    element.style.setProperty("padding", "0", "important");
  }

  // Поиск внешней обёртки рекламного блока для полного скрытия sticky/контейнеров
  function findAdWrapper(element) {
    let current = element;
    let wrapper = element;
    let depth = 0;

    while (current && current !== document.body && current !== document.documentElement && depth < 6) {
      const id = (current.id || "").toLowerCase();
      const cls = (typeof current.className === "string" ? current.className : "").toLowerCase();

      if (
        cls.includes("yandex-sticky") ||
        cls.includes("sticky-adv") ||
        cls.includes("sticky-banner") ||
        cls.includes("sticky_banner") ||
        cls.includes("floating-banner") ||
        id.includes("yandex-adv-sticky") ||
        id.includes("yandex_rtb") ||
        id.includes("adfox") ||
        current.hasAttribute("data-r-a-") ||
        cls.includes("wrapper_with-disable-ad-button")
      ) {
        wrapper = current;
      }
      current = current.parentElement;
      depth++;
    }
    return wrapper;
  }

  // Углублённая проверка элемента и его атрибутов на признаки рекламы
  function checkAdElement(element) {
    if (!element || !(element instanceof Element)) return false;

    // Проверка селектора
    if (element.matches && element.matches(COMBINED_SELECTOR)) {
      hideElement(findAdWrapper(element));
      return true;
    }

    // Проверка атрибутов data-r-a-* (характерных для РСЯ)
    for (let i = 0; i < element.attributes.length; i++) {
      const attrName = element.attributes[i].name;
      if (attrName.startsWith("data-r-a-") || attrName === "data-new-adtune" || attrName === "data-sticky-adtune") {
        hideElement(findAdWrapper(element));
        return true;
      }
    }

    // Проверка ссылок на переход в рекламу Яндекса / AdFox
    if (element.tagName === "A") {
      const href = element.getAttribute("href") || "";
      if (href.includes("yandex.ru/an/") || href.includes("an.yandex.ru") || href.includes("awaps.yandex.ru") || href.includes("adfox.ru") || href.includes("adriver.ru")) {
        hideElement(findAdWrapper(element));
        return true;
      }
    }

    // Проверка картинок баннеров Яндекса
    if (element.tagName === "IMG") {
      const src = element.getAttribute("src") || "";
      if (src.includes("avatars.mds.yandex.net/get-direct") || src.includes("avatars.mds.yandex.net/get-adfox")) {
        hideElement(findAdWrapper(element));
        return true;
      }
    }

    // Проверка вложенных закрытых shadow root template
    const templates = element.querySelectorAll ? element.querySelectorAll("template[shadowrootmode], template[shadowroot]") : [];
    for (const t of templates) {
      const html = t.innerHTML || "";
      if (html.includes("yandex.ru/an/") || html.includes("adaptiveConstructorAd") || html.includes("get-direct") || html.includes("data-ad-id")) {
        hideElement(findAdWrapper(element));
        return true;
      }
    }

    return false;
  }

  function scan(root = document) {
    if (!shouldHide()) return;
    ensureStyle();
    injectDefuser();

    if (root instanceof Element) {
      checkAdElement(root);
    }

    if (root.querySelectorAll) {
      root.querySelectorAll(COMBINED_SELECTOR).forEach((el) => hideElement(findAdWrapper(el)));

      // Поиск ссылок на кликовые трекеры рекламы
      root.querySelectorAll("a[href*='yandex.ru/an/'], a[href*='an.yandex.ru'], a[href*='awaps.yandex.ru'], a[href*='adfox.ru']").forEach((el) => {
        hideElement(findAdWrapper(el));
      });

      // Поиск баннерных изображений Директа
      root.querySelectorAll("img[src*='avatars.mds.yandex.net/get-direct'], img[src*='avatars.mds.yandex.net/get-adfox']").forEach((el) => {
        hideElement(findAdWrapper(el));
      });

      // Поиск элементов с атрибутами data-r-a-*
      root.querySelectorAll("[data-new-adtune], [data-sticky-adtune], [data-name='adaptiveConstructorAd']").forEach((el) => {
        hideElement(findAdWrapper(el));
      });
    }
  }

  function restore() {
    removeStyle();
    document.querySelectorAll(`.${HIDDEN_CLASS}`).forEach((el) => {
      el.classList.remove(HIDDEN_CLASS);
      el.style.removeProperty("display");
      el.style.removeProperty("height");
      el.style.removeProperty("min-height");
      el.style.removeProperty("margin");
      el.style.removeProperty("padding");
    });
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
      for (const node of nodes) {
        if (node instanceof Element) scan(node);
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

  // Наблюдение за динамически добавляемыми элементами страницы
  const observer = new MutationObserver((records) => {
    const added = [];
    for (const record of records) {
      if (record.type === "childList") {
        for (const node of record.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) added.push(node);
        }
      } else if (record.type === "attributes" && record.target instanceof Element) {
        checkAdElement(record.target);
      }
    }
    if (added.length) scheduleScan(added);
  });

  observer.observe(document.documentElement || document, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class", "id", "style", "data-name"],
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && (changes.enabled || changes.cosmeticEnabled || changes.allowlist)) {
      loadState();
    }
  });

  // Запуск при старте документа
  ensureStyle();
  injectDefuser();
  loadState();
})();
