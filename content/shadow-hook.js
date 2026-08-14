// Выполняется в MAIN world раньше кода страницы. Закрытый Shadow DOM нельзя
// открыть после создания, но можно безопасно отследить его host в момент создания.
// Креатив анимируется постоянно, поэтому после скрытия наблюдатель за поддеревом
// отключается — остаётся только дешёвый контроль style-атрибута самого host.
(() => {
  "use strict";

  const STATE_ATTRIBUTE = "data-adguardian-cosmetic";
  const HIDDEN_CLASS = "adguardian-yandex-ad-host-hidden";
  // Признаки креатива РСЯ внутри тени: счётчик an.yandex.ru и контейнеры R-I-*.
  const AD_MARKER = [
    "a[href*='an.yandex.ru/count']",
    "a[href*='yandex.ru/an/count']",
    "[id*='R-I-']",
    "iframe[src*='adfox']",
  ].join(",");
  const HOST_SELECTOR = "[id^='yandex_rtb'], [id^='yandex_ad'], [class*='yandex_rtb'], [data-adfox], [id*='R-I-']";
  // Защита от страниц, создающих сотни закрытых теней.
  const MAX_WATCHED = 64;

  const watched = new Map();   // host -> { styleObserver, rootObserver }
  const hidden = new Map();    // host -> { display, priority }
  let dirtyRoots = null;       // корни с мутациями, ждущие проверки в кадре

  function enabled() {
    return document.documentElement.getAttribute(STATE_ATTRIBUTE) === "on";
  }

  function releaseGameLock() {
    const body = document.body;
    if (!body) return;
    body.classList.remove("main-body_modal_yes", "main-body_scroll-hidden_yes");
  }

  // Страница может сбросить inline-стиль host — восстанавливаем скрытие.
  function watchHostStyle(host) {
    const entry = watched.get(host);
    if (!entry || entry.styleObserver) return;
    entry.styleObserver = new MutationObserver(() => {
      if (hidden.has(host)) host.style.setProperty("display", "none", "important");
    });
    entry.styleObserver.observe(host, { attributes: true, attributeFilter: ["style", "class"] });
  }

  function hide(host) {
    if (hidden.has(host)) return;
    hidden.set(host, {
      display: host.style.getPropertyValue("display"),
      priority: host.style.getPropertyPriority("display"),
    });
    host.classList.add(HIDDEN_CLASS);
    host.style.setProperty("display", "none", "important");
    releaseGameLock();
  }

  function restore() {
    for (const [host, previous] of hidden) {
      host.classList.remove(HIDDEN_CLASS);
      if (previous.display) host.style.setProperty("display", previous.display, previous.priority);
      else host.style.removeProperty("display");
    }
    hidden.clear();
  }

  function inspect(host, root) {
    if (!enabled() || hidden.has(host)) return true;
    if (host.matches(HOST_SELECTOR) || (root.querySelector && root.querySelector(AD_MARKER))) {
      hide(host);
      return true;
    }
    return false;
  }

  // Одна проверка на кадр вместо проверки на каждую мутацию.
  function markDirty(host, root) {
    (dirtyRoots ||= new Set()).add([host, root]);
    requestAnimationFrame(() => {
      const batch = dirtyRoots;
      dirtyRoots = null;
      if (!batch) return;
      for (const [h, r] of batch) {
        if (inspect(h, r)) stopRootObserver(h);
      }
    });
  }

  function stopRootObserver(host) {
    const entry = watched.get(host);
    if (entry && entry.rootObserver) {
      entry.rootObserver.disconnect();
      entry.rootObserver = null;
    }
    if (hidden.has(host)) watchHostStyle(host);
  }

  function watch(host, root) {
    if (watched.has(host) || watched.size >= MAX_WATCHED) return;
    const entry = { styleObserver: null, rootObserver: null };
    watched.set(host, entry);
    if (inspect(host, root)) {
      stopRootObserver(host);
      return;
    }
    entry.rootObserver = new MutationObserver(() => markDirty(host, root));
    entry.rootObserver.observe(root, { childList: true, subtree: true });
  }

  const originalAttachShadow = Element.prototype.attachShadow;
  Object.defineProperty(Element.prototype, "attachShadow", {
    configurable: true,
    writable: true,
    value(init) {
      const root = Reflect.apply(originalAttachShadow, this, [init]);
      if (init && init.mode === "closed") watch(this, root);
      return root;
    },
  });

  new MutationObserver(() => {
    if (enabled()) {
      for (const host of hidden.keys()) host.style.setProperty("display", "none", "important");
    } else {
      restore();
    }
  }).observe(document.documentElement, { attributes: true, attributeFilter: [STATE_ATTRIBUTE] });
})();
