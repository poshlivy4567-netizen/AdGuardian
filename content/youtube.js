// Лёгкая доработка плеера YouTube. Сетевые запросы плеера намеренно не
// подменяем: реклама и основной ролик часто приходят с одного домена
// googlevideo.com, а грубая блокировка ломает воспроизведение. Вместо этого
// скрываем UI рекламы через CSS и нажимаем только штатную кнопку пропуска.
(() => {
  "use strict";

  const STATE_ATTRIBUTE = "data-adguardian-cosmetic";
  const PLAYER_SELECTOR = "#movie_player.ad-showing, .html5-video-player.ad-showing";
  const SKIP_SELECTOR = [
    ".ytp-ad-skip-button-modern",
    ".ytp-ad-skip-button",
    ".ytp-ad-skip-button-slot button",
    "button[aria-label*='Пропустить рекламу']",
    "button[aria-label*='Skip Ads']",
    "button[aria-label*='Skip ad']",
  ].join(",");

  let scheduled = false;
  let pollTimer = null;
  let watchedPlayer = null;
  let playerObserver = null;

  function enabled() {
    return document.documentElement?.getAttribute(STATE_ATTRIBUTE) !== "off";
  }

  function isVisible(element) {
    const style = getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
  }

  function skipAd() {
    if (!enabled()) return;
    for (const button of document.querySelectorAll(SKIP_SELECTOR)) {
      if (!isVisible(button) || button.disabled || button.getAttribute("aria-disabled") === "true") continue;
      button.click();
      break;
    }
  }

  function syncPolling() {
    const adShowing = enabled() && Boolean(document.querySelector(PLAYER_SELECTOR));
    if (adShowing && !pollTimer) pollTimer = setInterval(skipAd, 500);
    if (!adShowing && pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function watchPlayer() {
    const player = document.querySelector("#movie_player, .html5-video-player");
    if (player === watchedPlayer) return;
    playerObserver?.disconnect();
    watchedPlayer = player;
    if (!player) return;
    playerObserver = new MutationObserver(schedule);
    playerObserver.observe(player, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "aria-label", "aria-disabled", "disabled"],
    });
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      watchPlayer();
      skipAd();
      syncPolling();
    });
  }

  new MutationObserver(schedule).observe(document, {
    childList: true,
    subtree: true,
  });

  document.addEventListener("yt-navigate-finish", schedule, true);
  document.addEventListener("yt-page-data-updated", schedule, true);
  const root = document.documentElement;
  if (root) {
    new MutationObserver(schedule).observe(root, {
      attributes: true,
      attributeFilter: [STATE_ATTRIBUTE],
    });
  }
  schedule();
})();
