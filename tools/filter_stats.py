# -*- coding: utf-8 -*-
"""Уточнённая статистика списков: разбор опций и конвертируемость в MV3 DNR."""
import re, collections

def split_opts(s):
    """Разделяет правило и опции ($...). Возвращает (body, opts_str)."""
    if "$" not in s or s.startswith("/"):
        return s, ""
    # ищем последний $, но не внутри regex /...$.../
    idx = s.rfind("$")
    return s[:idx], s[idx + 1:]

def classify(path):
    stats = collections.Counter()
    opt_counter = collections.Counter()
    host_simple = host_path = 0
    exceptions = 0
    conv_net = 0
    conv_opt = collections.Counter()  # какие опции у конвертируемых
    cosmetic = collections.Counter()
    total = 0
    with open(path, encoding="utf-8", errors="ignore") as f:
        for line in f:
            s = line.strip()
            if not s or s.startswith("!") or s.startswith("["):
                continue
            total += 1
            if "##" in s or "#@#" in s or "#?#" in s or "#$#" in s:
                if "#?#" in s: cosmetic["procedural"] += 1
                elif "#$#" in s: cosmetic["scriptlet"] += 1
                elif "#@#" in s: cosmetic["exception"] += 1
                else: cosmetic["normal"] += 1
                continue
            body, opts = split_opts(s)
            is_exc = body.startswith("@@")
            if is_exc:
                exceptions += 1
                body = body[2:]
            if body.startswith("/") and body.endswith("/"):
                stats["regex"] += 1
            elif body.startswith("||"):
                rest = body[2:]
                if "/" in rest:
                    stats["||host/path"] += 1
                else:
                    stats["||host^"] += 1
                    host_simple += 1
                # конвертируемо, если опции переводимы (проверим ниже)
                ok = True
                if opts:
                    for o in opts.split(","):
                        opt_counter[o.split("=")[0]] += 1
                        if o.split("=")[0] in (
                            "third-party", "script", "image", "media", "subdocument",
                            "xmlhttprequest", "object", "other", "frame", "stylesheet",
                            "domain", "match-case",
                        ):
                            pass
                        else:
                            ok = False
                if ok:
                    conv_net += 1
                    if opts:
                        for o in opts.split(","):
                            conv_opt[o.split("=")[0]] += 1
            elif body.startswith("|") and body.endswith("|"):
                stats["|anchored|"] += 1
            elif body.startswith("http://") or body.startswith("https://"):
                stats["full URL"] += 1
                conv_net += 1
            else:
                stats["plain"] += 1
                conv_net += 1
    print(f"{path}: всего {total}")
    print("  сетевые:", dict(stats))
    print(f"  исключений (@@): {exceptions}")
    print(f"  конвертируемых в DNR: {conv_net}")
    print(f"  конвертируемые по опциям: {dict(conv_opt)}")
    print("  косметика:", dict(cosmetic))

for p in ["easylist.txt", "adguard_ru.txt", "easyprivacy.txt"]:
    classify(p)
    print()
