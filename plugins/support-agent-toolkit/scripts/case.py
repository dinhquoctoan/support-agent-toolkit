#!/usr/bin/env python3
"""Case File helper - one folder per task, survives across Claude sessions.

  case.py init KEY [--title T] [--domain D] [--app A] [--storefront URL]
  case.py show KEY                 # meta + case.md (used when resuming)
  case.py set KEY a.b=value ...    # value is parsed as JSON when possible, otherwise kept as a string
  case.py log KEY "text"           # append one Timeline line
  case.py domain DOMAIN            # other cases on the same domain (history)
  case.py list [--open]
  case.py add-comment KEY COMMENT_ID [kind]   # record a posted comment (to learn from later edits)
  case.py pending-learn            # posted comments not yet compared with their latest version in the CRM
  case.py mark-learned KEY COMMENT_ID
  case.py secret DOMAIN            # print the storefront password from the user's private secrets file
  case.py where                    # print the cases dir / secrets file / comment rules paths

Env: SAT_CASES_DIR (default ~/support-cases), SAT_SECRETS_FILE (default
~/.config/support-agent/store-passwords.md, lines like "domain: password"), SAT_TASK_PREFIX (default TASK,
used when a bare number is typed), SAT_CRM_TASK_URL (default https://crm.example.com/tasks/{key}).
"""
import json, os, re, sys, datetime as dt
from pathlib import Path

ROOT = Path(os.environ.get("SAT_CASES_DIR") or Path.home() / "support-cases").expanduser()
PW_FILE = Path(os.environ.get("SAT_SECRETS_FILE") or Path.home() / ".config/support-agent/store-passwords.md").expanduser()
RULES_FILE = ROOT / "_comment-rules.md"   # comment-format rules the user approved (docs-task)
PREFIX = os.environ.get("SAT_TASK_PREFIX", "TASK")
CRM_URL = os.environ.get("SAT_CRM_TASK_URL", "https://crm.example.com/tasks/{key}")
OPEN = {"investigating", "fixing", "verifying", "drafted", "waiting-customer"}

TEMPLATE = """# {key} - {title}

## Request
- [ ]

## Native-first
_(native / config only / custom / not possible - with sources)_

## Hypotheses
_(confirmed / ruled out / unclear - one hypothesis per line + evidence)_

## Deployed changes
_(where it was deployed - hotfix version / theme file - code file in code/)_

## Verify / Proof
_(proof.json + result of the latest run)_

## Notes for next time
_(domain/theme quirks, things the customer tends to ask again, access...)_

## Timeline
"""


def now():
    return dt.datetime.now().strftime("%Y-%m-%d %H:%M")


def norm_key(k):
    m = re.search(r"\b[A-Z][A-Z0-9]*-\d+\b", k.upper())
    if not m and re.fullmatch(r"\s*\d{3,6}\s*", k):
        return f"{PREFIX}-{k.strip()}"
    if not m:
        sys.exit(f"Invalid task key: {k}")
    return m.group(0)


def cdir(key):
    return ROOT / norm_key(key)


def load(key):
    p = cdir(key) / "meta.json"
    if not p.exists():
        sys.exit(f"No case {norm_key(key)} yet - run init first.")
    return json.loads(p.read_text())


def save(key, meta):
    meta["updated"] = now()
    (cdir(key) / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2))


def opt(args, name):
    if name in args:
        i = args.index(name)
        v = args[i + 1]
        del args[i:i + 2]
        return v
    return None


def cmd_init(args):
    key = norm_key(args.pop(0))
    title, domain, app, sf = (opt(args, n) for n in ("--title", "--domain", "--app", "--storefront"))
    d = cdir(key)
    ROOT.mkdir(parents=True, exist_ok=True)
    if (d / "meta.json").exists():
        print(f"[resume] case {key} already exists.\n")
        return cmd_show([key])
    for sub in ("code", "proof", "drafts"):
        (d / sub).mkdir(parents=True, exist_ok=True)
    meta = {
        "task_key": key, "title": title or "", "app": app or "", "domain": bare(domain),
        "storefront": sf or "", "theme": {}, "status": "investigating",
        "access": {"partner": "unknown", "fe_password": "unknown", "readonly": True},
        "posted_comments": [], "crm_url": CRM_URL.replace("{key}", key),
        "created": now(),
    }
    save(key, meta)
    (d / "case.md").write_text(TEMPLATE.format(key=key, title=title or "") + f"- {now()} · case created\n")
    print(f"[new] {d}")
    if domain:
        cmd_domain([domain], exclude=key)


def cmd_show(args):
    key = norm_key(args[0])
    print(json.dumps(load(key), ensure_ascii=False, indent=2))
    print("\n" + (cdir(key) / "case.md").read_text())
    proofs = sorted((cdir(key) / "proof").glob("run-*/results.md"))
    if proofs:
        print(f"\n[latest proof] {proofs[-1]}")


def setpath(obj, path, val):
    parts = path.split(".")
    for p in parts[:-1]:
        obj = obj.setdefault(p, {})
    obj[parts[-1]] = val


def cmd_set(args):
    key = norm_key(args.pop(0))
    meta = load(key)
    for a in args:
        k, v = a.split("=", 1)
        try:
            v = json.loads(v)
        except Exception:
            pass
        setpath(meta, k, v)
    save(key, meta)
    print("ok", {a.split("=")[0] for a in args})


def cmd_log(args):
    key = norm_key(args[0])
    text = " ".join(args[1:]).strip()
    p = cdir(key) / "case.md"
    p.write_text(p.read_text().rstrip("\n") + f"\n- {now()} · {text}\n")
    save(key, load(key))
    print("logged")


def bare(domain):
    if not isinstance(domain, str):   # older meta may hold a number (e.g. storefront=5)
        return ""
    return re.sub(r"^https?://|/.*$", "", domain or "").lower().removeprefix("www.")


def cmd_domain(args, exclude=None):
    want = bare(args[0])
    hits = []
    for m in ROOT.glob("*/meta.json"):
        meta = json.loads(m.read_text())
        if meta["task_key"] == exclude:
            continue
        if want and want in (bare(meta.get("domain")), bare(meta.get("storefront"))):
            note = ""
            body = (m.parent / "case.md").read_text()
            sec = re.search(r"## Notes for next time\n(.*?)\n## ", body, re.S)
            if sec:
                note = " ".join(l.strip("- ") for l in sec.group(1).splitlines() if l.strip() and not l.startswith("_"))
            hits.append(f"- {meta['task_key']} [{meta['status']}] {meta['title']}" + (f"\n    -> {note[:300]}" if note else ""))
    print(f"[domain {want}] {len(hits)} earlier case(s):" if hits else f"[domain {want}] no earlier cases.")
    print("\n".join(hits))


def cmd_list(args):
    only_open = "--open" in args
    for m in sorted(ROOT.glob("*/meta.json"), key=lambda p: p.stat().st_mtime, reverse=True):
        meta = json.loads(m.read_text())
        if only_open and meta["status"] not in OPEN:
            continue
        print(f"{meta['task_key']:16} {meta['status']:17} {meta.get('updated','')}  {meta.get('domain','')}  {meta['title'][:60]}")


def cmd_add_comment(args):
    key = norm_key(args[0])
    meta = load(key)
    meta["posted_comments"].append({"id": args[1], "kind": args[2] if len(args) > 2 else "crm",
                                    "posted": now(), "learned": False})
    save(key, meta)
    print("ok")


def cmd_pending_learn(args):
    for m in ROOT.glob("*/meta.json"):
        meta = json.loads(m.read_text())
        for c in meta.get("posted_comments", []):
            if not c.get("learned"):
                print(f"{meta['task_key']} {c['id']} posted={c['posted']} draft={m.parent/'drafts'/('posted-'+c['id']+'.md')}")


def cmd_mark_learned(args):
    key = norm_key(args[0])
    meta = load(key)
    for c in meta["posted_comments"]:
        if c["id"] == args[1]:
            c["learned"] = True
    save(key, meta)
    print("ok")


def cmd_secret(args):
    want = bare(args[0])
    if PW_FILE.exists():
        for line in PW_FILE.read_text().splitlines():
            m = re.match(r"^\s*([\w.-]+\.[a-z]{2,})\s*:\s*(\S+)\s*$", line)
            if m and bare(m.group(1)) == want:
                print(m.group(2))
                return
    sys.exit(f"No password for {want} in {PW_FILE}")


def cmd_where(args):
    print(f"cases:   {ROOT}{'' if ROOT.exists() else ' (not created yet)'}")
    print(f"secrets: {PW_FILE}{'' if PW_FILE.exists() else ' (missing)'}")
    print(f"rules:   {RULES_FILE}{'' if RULES_FILE.exists() else ' (missing)'}")


CMDS = {"init": cmd_init, "show": cmd_show, "set": cmd_set, "log": cmd_log, "domain": cmd_domain,
        "list": cmd_list, "add-comment": cmd_add_comment, "pending-learn": cmd_pending_learn,
        "mark-learned": cmd_mark_learned, "secret": cmd_secret, "where": cmd_where}

if __name__ == "__main__":
    if len(sys.argv) < 2 or sys.argv[1] not in CMDS:
        sys.exit(__doc__)
    CMDS[sys.argv[1]](sys.argv[2:])
