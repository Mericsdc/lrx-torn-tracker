# Employees page and Rehab messages — design (short)

## Intent
The owner finds the Employees page unprofessional and the Rehab Message Generator cluttered: a Critical / Warning /
All filter, three template buttons, an editable template box, an "early reminder" note, a full message card per
employee with Copy and "Send via Chat", and a second Copy / Send column in the table that runs off the card at
1440 px. Only employees at -8 or worse matter. The message only has to be polite and say what it should.

## Goals
- The Rehab card lists only employees at addiction -8 or worse, with one polite English message and a Copy button
  per employee. Nothing else to pick.
- The rest of the page reads calmer, in the style of the redesigned Stock Status page.
- EN default with a TR pair for every UI string; narrow and wide widths; reduced motion and `body.no-anim` respected.

## Non-goals / anti-goals
- No server or `/api/company` change; no new Torn requests.
- The app never types into, clicks on or sends anything on Torn. The message is only copied; the player sends it.
- No edits to `public/themes.css` (Themes session); `.rehab-msg-box` keeps its name because themes.css styles it.

## Decisions (owner)
- Approved: only the -8 or worse case, one message, Copy kept, filter / templates / custom box / note / Send via
  Chat removed, the table's Rehab column removed, 4 KPI tiles, card rows at narrow widths, other "Copy rehab
  message" buttons (Overview list, browser bar) only at -8 or worse.
- **Message is always English** (Torn's shared language), whatever the app language:
  "Hi {name}, your addiction is at {addiction} right now, which lowers your work effectiveness. When you get a
  chance, could you please fly to Switzerland and do a Rehab? Thank you!"

## Approaches
- **A · One preview + one row per employee** — picked. The message is shown once (for the worst employee); each
  row has name, position, status, addiction and "Copy message". Short even with many employees.
- B · One card per employee with its own full message — the current shape minus the clutter; repeats nearly the
  same sentence N times.

## Design
1. **KPI row, 4 tiles**: Employees (hired/capacity) · Daily wages · Avg. effectiveness · Needs rehab (≤ -8), red
   when > 0, hint "nobody at -8 or worse" when 0. The "With addiction" tile goes.
2. **Rehab card** (`#rehab-card`): head "Rehab needed" + muted "Addiction at -8 or worse · copy the message and send
   it yourself on Torn", count on the right. Message preview (`.rehab-msg-box`) for the first employee, then one row
   per employee (`[data-rehab-emp]`): profile link, position, status chip (In Switzerland when abroad there),
   addiction chip, `[data-copy-rehab]` button whose tooltip is that employee's message. With nobody at -8 or worse
   the card is one calm line: "✓ No employee is at -8 or worse."
3. **Table** "Employees & Addiction": the Rehab Message column goes. Addiction: a red "-11 · Rehab" chip at -8 or
   worse, a plain number below 0, a muted 0 otherwise (no "Warning"/"Clean" labels). Rows at -8 or worse get a thin
   red accent. Every `td` carries `data-label` = its column header; a container query turns rows into cards on
   narrow cards, like the Stock products table.
4. **Removed code**: `REHAB_TEMPLATES`, `state.rehabTpl*`, `state.rehabFilter`, the filter / template / template
   input handlers, `sendRehabChat`, the `torn-chat-send` IPC handler (`src/main/electron-main.js`) and
   `tornChatSend` (`src/main/preload.js`); the old `tt.rehab*` localStorage keys are cleared.

## Left to the builder
Spacing, the container-query breakpoint and card order, chosen from screenshots at 1440 / 1100 / 640.

## Tests
New `tests/employees-ui-smoke.js` (fixture `tests/employees-fixture.js`, invented data, every non-local request
aborted): tiles, only -8-or-worse rows, the exact English copied text (also in TR), none of the removed controls,
the empty state, Overview copy buttons only at -8 or worse, table labels, widths 1440/1100/640 without sideways
scroll, no NaN/undefined, no page errors. A node test checks that the chat-typing IPC is gone.
