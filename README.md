# AdGuardian

Приватный блокировщик рекламы, sticky-баннеров и трекеров для Chromium-браузеров: Chrome, Яндекс Браузер, Opera, Edge и совместимых. Расширение работает на Manifest V3 и не отправляет историю посещений на внешние серверы.

## Что умеет

- **Полная блокировка рекламы и трекеров**: загружает более **115 000+ правил** из EasyList, AdGuard Russian и EasyPrivacy без искусственного ограничения в 28–30k благодаря многоуровневой архитектуре статических и динамических ruleset'ов Manifest V3.
- **Блокировка sticky-баннеров и Яндекс рекламы**:
  - Скрывает плавающие и залипающие баннеры (desktop/mobile sticky wrappers).
  - Вырезает блоки Яндекс Директ / РСЯ (`adaptiveConstructorAd`, `adWrapper`, `data-r-a-*`, Shadow DOM баннеры, спиннеры).
  - Нейтрализует JS SDK Яндекса и AdFox (`yaContextCb`, `Ya.Context.AdvManager`, `adfoxCode`) на уровне контекста страницы (MAIN world) до их запуска.
  - Блокирует сетевые запросы к `an.yandex.ru`, `awaps.yandex.ru`, `adfox.ru`, `yabs.yandex.ru`, `mc.yandex.ru`, клик-трекерам `yandex.ru/an/count/` и баннерным CDN `avatars.mds.yandex.net/get-direct/`.
- **Поддержка динамических обновлений**: загружает свежие правила через сеть (в рамках лимита Chrome), не затрагивая пользовательские исключения.
- **Управление сайтами и исключениями**: пауза блокировки в один клик для текущего домена.
- **Локальная статистика**: приватный подсчёт остановленных запросов без сохранения конфиденциальных параметров URL.

## Установка распакованного расширения

1. Откройте страницу расширений браузера: `chrome://extensions`, `browser://extensions` или `opera://extensions`.
2. Включите **Режим разработчика** (Developer mode).
3. Нажмите **Загрузить распакованное расширение** (Load unpacked) и выберите папку проекта `AdGuardian`.
4. Закрепите AdGuardian на панели расширений.

## Архитектура фильтрации

| Ruleset / Слой | Правил | Назначение |
| --- | ---: | --- |
| `rules/ads_rules.json` | 68 | Курируемые правила блокировки Яндекс Директ, AdFox, видео-плееров и РСЯ |
| `rules/adguard_ru.json` | 1 650 | Региональные правила AdGuard Russian |
| `rules/easyprivacy_1.json` + `_2.json` | 54 524 | Полная база трекеров и систем телеметрии EasyPrivacy |
| `rules/easylist_1.json` + `_2.json` + `_3.json` | 59 170 | Полная база блокировки рекламы EasyList |
| **Всего статических правил** | **115 412** | Работают мгновенно, без задержек и без лимита динамических правил |
| **Динамические правила** | до 25 000 | Сетевые обновления фильтров с запасом для whitelist пользователя |
| `content/cosmetic.js` | Расширенный | JS-нейтрализатор SDK Яндекса/AdFox + CSS-скрытие sticky-баннеров и контейнеров |

## Разработка и проверка

Требуется Node.js 18+.

```bash
node tools/build_subscriptions.js
node tools/test_engine.js
node tools/test_runtime.js
node tools/test_cosmetic.js
```

- `tools/build_subscriptions.js`: компилирует списки фильтров в оптимизированные файлы ruleset'ов.
- `tools/test_engine.js`: проверяет трансляцию фильтров, валидность ID и отсутствие дубликатов.
- `tools/test_runtime.js`: проверяет работу хранилища, динамических правил и сохранение пользовательского whitelist.
- `tools/test_cosmetic.js`: проверяет селекторы скрытия sticky-баннеров и разметки Яндекса.

## Структура проекта

```text
AdGuardian/
├── background.js                 # Service Worker (DNR rulesets, whitelist, обновления)
├── content/
│   └── cosmetic.js               # Косметический фильтр, дефьюзер JS API и скрытие баннеров
├── lib/
│   ├── filters.js                # Конвертер ABP/uBlock -> DNR, группировка и сетевой парсер
│   └── static-meta.js            # Метаданные и статистика встроенных правил
├── manifest.json                 # Manifest V3 конфигурация расширения
├── rules/                        # Скомпилированные JSON-правила Declarative Net Request
│   ├── ads_rules.json
│   ├── adguard_ru.json
│   ├── easyprivacy_1.json, easyprivacy_2.json
│   └── easylist_1.json, easylist_2.json, easylist_3.json
├── popup/                        # Popup интерфейс расширения
├── stats/                        # Страница детальной статистики
└── tools/                        # Исходные списки фильтров, тесты и скрипты сборки
```
