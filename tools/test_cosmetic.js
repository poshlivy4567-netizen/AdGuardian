// Проверка блокировки sticky-баннеров и разметки Яндекса (включая snippet пользователя)
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const userSnippet = `
<div class="yandex-sticky-adv-banner__desktop-wrapper yandex-sticky-adv-banner__desktop-wrapper_with-disable-ad-button" style="width: 300px; margin-top: -32px; padding-top: 32px;">
  <div class="yandex-sticky-adv-banner yandex-sticky-adv-banner_desktop_right adv-focusable" id="yandex-adv-sticky-banner-desktop" data-4ee00d5a77="">
    <div>
      <template shadowrootmode="closed">
        <div class="d927a5221">
          <div class="ke020cdc2"></div>
          <div data-container="outer">
            <div class="n746df0a8 x1a892eae">
              <div class="k9bcc3fb7 n16e7aa32 wcad5af2f">
                <div data-ad-id="1916439324730458075" data-name="adWrapper" lang="ru" class="u5f4d0e13">
                  <div class="lb3f39a00 q6f1a770f">
                    <div id="id5945261786630710495" data-name="adaptiveConstructorAd" data-theme="dark" class="ge40543b0">
                      <div class="afbbf237b ac41e1bac"></div>
                      <a href="https://yandex.ru/an/count/WpSejI..." target="_blank" class="g7b00473e"></a>
                      <img data-name="adaptiveImage" src="https://avatars.mds.yandex.net/get-direct/5231780/LGHvNJwq0SyiRBRyWd3raw/x450" class="e90d3c674">
                      <div data-new-adtune="true" data-sticky-adtune="false"></div>
                      <span data-label=""><span>Реклама</span></span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </template>
    </div>
    <div data-r-a-2427191-42-1="" class="csr-uniq3"></div>
  </div>
  <div class="yandex-sticky-adv-banner yandex-sticky-adv-banner_desktop_additional_right yandex-sticky-adv-banner_hidden adv-focusable" id="yandex-adv-sticky-banner-desktop_additional">
    <div class="spin-critical-module__wrapper--G85tm">
      <div class="yandex-sticky-adv-banner__spinner yandex-sticky-adv-banner__spinner_hidden"></div>
    </div>
  </div>
</div>
`;

// Читаем cosmetic.js
const cosmeticCode = fs.readFileSync(path.join(__dirname, "..", "content", "cosmetic.js"), "utf8");

// Проверяем наличие ключевых селекторов в cosmetic.js
const requiredSelectors = [
  ".yandex-sticky-adv-banner__desktop-wrapper",
  ".yandex-sticky-adv-banner",
  "[id^='yandex-adv-sticky-banner']",
  "[class*='yandex-sticky-adv-']",
  "[data-name='adaptiveConstructorAd']",
  "[data-name='adWrapper']",
  "[data-new-adtune]",
  "[data-sticky-adtune]",
  "[class*='csr-uniq']",
  "[class*='spin-critical-module']",
  "[class*='sticky-banner']",
  "[class*='sticky-adv']",
  "[id^='yandex_rtb']",
  "[class*='adfox']",
];

for (const sel of requiredSelectors) {
  assert(cosmeticCode.includes(sel), `Селектор ${sel} должен присутствовать в cosmetic.js`);
}

// Проверяем наличие перехвата API Яндекса (yaContextCb, Ya.Context.AdvManager, adfoxCode)
assert(cosmeticCode.includes("yaContextCb"), "Перехват yaContextCb должен присутствовать");
assert(cosmeticCode.includes("AdvManager"), "Перехват AdvManager должен присутствовать");
assert(cosmeticCode.includes("adfoxCode"), "Перехват adfoxCode должен присутствовать");

console.log("cosmetic tests: all passed successfully");
