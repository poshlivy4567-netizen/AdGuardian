// Скачивает исходники подписок в tools/ для локальной сборки ruleset.
// Запуск: node tools/download_filters.js
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const sandbox = { console, setTimeout, clearTimeout, URL, AbortController, fetch, globalThis: {} };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(root, "lib", "filters.js"), "utf8"), sandbox);

const fileNames = {
  easylist: "easylist.txt",
  "adguard-ru": "adguard_ru.txt",
  easyprivacy: "easyprivacy.txt",
};

(async () => {
  let failed = false;
  for (const source of sandbox.FILTER_SOURCES) {
    try {
      const text = await sandbox.fetchText(source.url);
      fs.writeFileSync(path.join(__dirname, fileNames[source.name]), text, "utf8");
      const rules = text.split(/\r?\n/).filter((line) => line && !line.startsWith("!") && !line.startsWith("[")).length;
      console.log(`${source.name}: ${rules} строк правил`);
    } catch (error) {
      failed = true;
      console.error(`${source.name}: не удалось скачать (${error.message || error})`);
    }
  }
  if (failed) process.exit(1);
  console.log("Готово. Теперь: node tools/test_engine.js && node tools/build_subscriptions.js");
})();
