---
name: docs-task
description: '"docs task" / "redo docs" / "write the comment" = compose the CRM comment in the fixed format "CS summary / Root Cause / Solution / Technical Details / Result" from the Case File and POST it to the task right away with proof images (no waiting for "post"). A short internal chat message or a customer-ready reply for CS is drafted ONLY when the user asks for it. Learns from the user''s edits to posted comments (proposes a rule, waits for approval).'
---

# Docs task

Tool: `C="${CLAUDE_PLUGIN_ROOT}/scripts/case.py"`. Format rules are in "Comment format" below, plus the user's own
approved rules in `$SAT_CASES_DIR/_comment-rules.md` (if present; `python3 "$C" where` shows the path) - read them before
writing; the user's rules take precedence over the defaults.

## Comment format (team default)
Fixed order, the opening line "CS summary:" is mandatory - use all 5 headings even for short comments:
```
CS summary:
Root Cause:
Solution:
Technical Details:
Result:
```
- **CS summary** is not just a heading: 2-4 sentences in the team's working language (not in the customer's language
  - translating is CS's job) saying exactly what CS needs to tell the customer: the cause in plain words + what the
  customer needs to do / what happens next, so CS can copy it without reading the technical part. The first line names
  whatever still needs custom work (if any); keep limitations short in parentheses (e.g. "(the app has no built-in
  time-based option)"); several options -> number them.
- **Bold:** the 5 headings are bold. Inside "CS summary", bold only the keywords CS/the customer must catch: tag names
  (**wholesale_vip**), paths inside the app (**App > Customers > Auto tags**), setting/option names
  (**Manual approval**, **App embed**), the outcome phrase (**should see regular prices only**), **Note**, and anything
  needing custom work/escalation (**needs a custom solution**). Keep Root Cause / Solution / Technical Details / Result
  bodies plain, no inline bold.
- Short: one line per point, no long explanations, no version-by-version history. Steps for the customer -> Solution;
  code/rules/data -> Technical Details. Anything without data yet (e.g. not tested) -> leave empty, never invent it.
- A follow-up to a CS comment -> a NEW top-level comment, not a reply under it.

## 0. Learn from earlier edits (quick, max 3 comments)
`python3 "$C" pending-learn` -> for each line: `read_task_comments(<KEY>, fields=["commentId","body","updatedAt"])`,
compare the current body with `drafts/posted-<id>.md`.
- Difference is a typo/task-specific content -> skip.
- Difference is a **rule** (bolded something extra, changed tone, removed/added a section, length) -> tell the user in
  1-2 lines "You changed X -> propose adding rule Y", **wait for approval**, only then append one rule line to
  `_comment-rules.md`.
- `python3 "$C" mark-learned <KEY> <id>` once handled (skipped included). This step never blocks steps 1-3.

## 1. Fact sheet (from the case, do not ask again)
`python3 "$C" show <KEY>` + latest proof (`proof/run-*/results.md` + png) + screenshots taken this session. Core facts
missing (not verified, root cause unclear) -> STOP, say exactly what is missing, never post a guess.

## 2. Compose + post the CRM comment (default, no waiting for "post")
- Exact format above + **Content rules** below; with a proof run -> Result is a compact page x result table.
- Proof images: for each image `request_task_attachment_upload` -> run its `uploadCommand` from the image folder ->
  `attachments` (no base64). Images that are only attachments may not render inline in the CRM UI -> also embed an
  `<img>` (uploaded image URL) in the content when the image should be visible inline. Prefer the newest proof run +
  verify screenshots from this session; at most ~6 images.
- Comment type: default is a **new top-level comment**. User says "edit the original comment"/"edit comment X" ->
  `update_task_comment` (only comments that are `isMine`). "reply" -> `root_comment_id`. A link with `?comment=<id>`
  and no explicit instruction -> new comment that references that comment's content.
- HTML: `<p>`, `<strong>`, `<ul>`, `<table>`.
- After posting: print the posted content + `webUrl`; save the HTML to `drafts/posted-<commentId>.md`;
  `python3 "$C" add-comment <KEY> <commentId>`; `python3 "$C" set <KEY> status=posted`; `python3 "$C" log <KEY> "posted <commentId>"`.
- The user later asks to change it ("fix ...") -> `update_task_comment` on that same comment, never a new one.

## 3. Only when the user asks for more
- **Internal chat message** ("a short message for the team chat"): 2-4 lines, internal chat tone, no headings: what was
  done / result / what CS needs to do. Never send it on your own - only when the user explicitly says to reply, in the
  exact thread they name.
- **Customer-ready reply for CS**: ready to send as-is, no internal jargon (hotfix, hook, selector).
Save as `drafts/chat.md` / `drafts/cs.md`.

## Content rules (check-task reads this section too)
Distilled from a blind review of 16 graded tasks: the most frequent mistakes were leaking internal names, Result turning
into a checklist, and listing hypotheses instead of committing to one. 5 bold sections, fixed order; written entirely in
the team's working language (CS translates for foreign customers); each section <= 6 lines, the whole comment <= ~2500
characters (Result table excluded).
1. **CS summary** (2-4 sentences CS forwards straight to the customer): the cause in plain words + what the customer
   needs to do / what happens next. Bold only keywords CS/the customer must see (tag, path in the app, setting name,
   outcome, **Note**, custom work needed). FORBIDDEN: internal file/function names, task keys, internal versions,
   "hotfix service", "hook", "selector", investigation questions, a generic "we are checking", "please send more ..."
   (questions for the customer/CS go to the user separately). Never tell the customer to change or toggle a setting
   based on an unchecked 🔴 hypothesis - if they follow it and the problem stays, trust is lost (this happened: a
   hypothesis was "confirmed" and the customer was told to enable a template/setting -> wrong).
2. **Root Cause**: one main cause + confidence (🟢 seen/reproduced on the site · 🟡 inferred from code + facts ·
   🔴 hypothesis). The hypothesis must fit EVERY fact in the task (earlier orders worked / later ones fail, timeline,
   timestamps -> not a static config issue; which email/template wording -> which app). Several possibilities -> commit
   to one, wrap the others in one line "ruled out: ... / still to rule out: ..."; never list 3 equal hypotheses and leave
   the customer/CS to check. For 🔴 (no evidence from the store/logs, only inferred from code): write "Not yet
   determined" + 1-2 distinguishing facts the support engineer will collect from the store (e.g. whether the failing
   orders carry a specific tag); the CS summary then only says support is checking X on our side, with no self-fix
   instructions for the customer.
3. **Solution**: what was done or must be done, numbered; native/config first, custom after; when a rule condition
   changes (e.g. Signed-in -> Tagged), include the catch-up step for existing customers/data; when handing over to
   another app/team, state the team + timeline + related task (task keys only here and in Technical Details).
4. **Technical Details**: mechanism + related setting/rule/version/plan, in words. File/function/code paths only when a
   developer must go to exactly that place (max 2, no line numbers). Never mention other shops, never paste console
   commands for the customer.
5. **Result**: only what WAS verified (page x result; compact table with a proof run) or exactly one line "Not verified
   on the store because ...". Never a checklist of unfinished work ("[ ]", "to verify:", "next steps:"). Remaining work,
   missing facts, questions for CS -> tell the user separately, not in the comment.
6. Native-first includes built-in Shopify features (Flow, Markets, Forms, Merge customers...) and features of the
   vendor's other apps before proposing custom work or "not possible".
