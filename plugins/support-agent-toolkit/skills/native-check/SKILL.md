---
name: native-check
description: Answer "can the app do X / does this need custom work" with a 4-level matrix - NATIVE / CONFIG ONLY / CUSTOM / NOT POSSIBLE - with sources (docs, latest release notes, known workarounds, code). Use for question tasks, customisation requests, or when the user asks "is there a setting that does ...". check-task calls this skill before proposing code.
---

# Native-first check

Goal: avoid writing custom code for something the app already does (custom = maintenance debt). Answer fast, with sources.
Search keywords: English + the team's working language + the app's feature names.

## Look up in this order (stop once confident)
1. **Latest features** - CRM MCP: `app_read(app_handle, include=["changelog"])` (release notes) and
   `knowledge_search` (q = keywords). With `$SAT_KB_DIR` -> also `grep -ri` its release-notes digest.
   Items marked "(not released yet)" / only present in docs = code NOT shipped -> never tell the customer it exists.
2. **Official docs** - WebFetch the app's public docs; `knowledge_read` for KB pages found in step 1;
   `$SAT_KB_DIR` docs folders if present.
3. **Known workarounds/how-tos** - resolved tasks (`search_tasks`/`knowledge_search`, old cases in `$SAT_CASES_DIR`),
   and with the app source (`$SAT_APP_REPO`): its docs/workarounds/reference/release notes folders.
4. **Code** - only when 1-3 cannot answer a technical limit and `$SAT_APP_REPO` is set: `codegraph explore "<question>"`
   (if the repo has `.codegraph/`) or grep the repo. No code available -> say the confidence is lower.

## Output (short, one line per point)
| Sub-request | Level | How / setting (path inside the app) | Source |
|---|---|---|---|
- Level: ✅ Native · ⚙️ Config (combine existing settings/rules) · 🛠 Custom (effort estimate: S <1h / M 1-3h / L >3h, and the
  hook point: hook/filter/hotfix) · ⛔ Not possible (reason + alternative / another app).
- State the required plan if the feature is plan-gated, and "(not released yet)" if it only exists in docs.
- End with one sentence: which direction to take.
When called from check-task -> write the table into the `## Native-first` section of case.md.
