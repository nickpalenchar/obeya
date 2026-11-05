# Built-in card labels: category, complexity, priority

## Goal

Give every card built-in labels beside its priority: a category with a sub-category, and a
complexity of 1, 2, 3, 5, 8, 13 or 21. Where the owner leaves a label empty, Obeya suggests one in the
short session that already names a card, and marks it as its suggestion until the owner touches it.
Which labels Obeya may suggest is a toggle per canvas, and new canvases take their toggles from
"Canvas defaults" in the Konfiguration dialog. Like priority, the labels are the owner's: stored in
this Obeya, never in plan docs, and not told to agents.

## Shape

- **Fixed lists**, built in, the same for every repository (not a repository setting):
  - Category: Frontend, Backend, Data Migration, Docs, Tooling.
  - Sub-category: Refactor, New feature, Bug fix, Configuration.
  - A card has at most one category and one sub-category; a sub-category can be set without a
    category and the other way round.
- **Complexity**: 1, 2, 3, 5, 8, 13, 21 (Fibonacci), shown as numbers without descriptions in
  the picker, tooltips and suggestion scale (owner feedback on W2, 2026-11-04).
- **Priority** stays as it is (six levels, a label only); it joins the suggestion and its toggle.
- **Suggested labels**: Obeya fills only labels that are empty and never overwrites one the owner
  set. Each label it fills carries a "suggested" mark, drawn with the same dashed border and colour as a proposal card. Any
  owner action on that label (picking the same value, another one, or „Keine“) clears the mark;
  „Keine“ leaves the label empty and stops Obeya from suggesting it again for that card.
- **Suggestion styling**: the chip uses a proposal card's dashed border and colour; the card's own
  frame and fill still show its state (owner feedback on W2, 2026-11-04).
- **When Obeya suggests**: in the naming session of the „Kleine Aufgaben“ group, one call that
  returns the title and the labels together, when a card without a title is closed or started; for a
  card that already has a title (typed, a proposal, a workstream), in one short session of the same
  group when it starts. A card whose labels are all set, or whose canvas has every toggle off, runs
  no session for them.
- **„CLAUDE.md ergänzen“** gets category Docs and sub-category Configuration from Obeya itself when
  the card is made, marked as suggested like any other suggestion.
- **Canvas setting „Obeya schlägt vor“**: toggles for Category (with its sub-category), Complexity
  and Priority, all on by default; a label added later brings its own toggle.
- **„Canvas defaults“** in the Konfiguration dialog (beside Allgemein): the same toggles, copied into
  a canvas when it is created; changing them later leaves existing canvases alone. Every canvas
  setting has a default there, and a test fails when one is added without.

## Workstreams

- [ ] **W1:** Labels in the data and the API. Add category, sub-category and complexity to the card
  record next to priority, each with its "suggested" mark, stored in this Obeya like priority (never
  in plan docs), and the built-in lists and complexity descriptions in one shared place for server,
  UI and skill. Setting a label through the API clears its mark; a "suggest" write fills only empty,
  never-cleared labels and sets the mark. Old cards read as having no labels. Agents' prompts and
  tools stay without the labels. Tests for the writes, the marks and the never-overwrite rule.
- [x] **W2:** Pickers and chips on the card. Done (2026-11-04): `src/ui/labels.tsx` draws the face's
  priority flag and chips (complexity as rising bars and its number) and the unfolded card's four
  pickers; the complexity list shows the seven Fibonacci values without descriptions. A
  suggested label has the proposal's dashed border and colour; any
  pick, the same value included, sends the PATCH that makes it the owner's. A project's head shows
  its labels on a separate line below its title and actions, above the workstreams.
- [ ] **W3:** The suggestion. A plugin skill that judges category, sub-category, complexity and
  priority from a card's title, text and screenshots, with the lists and the complexity scale in it.
  Hook it into the naming session (one call returns the title and the labels) and, for a card that
  already has a title, into one short session at its start; only labels that are empty and whose
  canvas toggle is on are asked for, and none at all when nothing is left. A failed or slow session
  leaves the labels empty and never holds up the start. Tested against the fake runtime: fills only
  empty labels, respects the toggles, keeps an owner's pick made meanwhile, one call per card.
- [ ] **W4:** Canvas toggles and Canvas defaults. The per-canvas toggles „Obeya schlägt vor“
  (Category with sub-category, Complexity, Priority; on by default) in the canvas's page under
  Leinwände, and the read by W3. A „Canvas defaults“ section in the Konfiguration dialog with the
  same toggles, applied when a canvas is created. A test that lists every canvas setting and fails
  when one has no entry in Canvas defaults; the design chapter states the rule.
- [ ] **W5:** „CLAUDE.md ergänzen“ is labelled. The card the Koordinator makes for rules of a
  CLAUDE.md gets category Docs and sub-category Configuration as Obeya's suggestion when it is made,
  regardless of the toggles' session (it needs none), so the owner can tell it apart on the canvas.
- [ ] **W6:** Design docs. Move what passes the rebuild test into the chapters: the labels and the
  suggested state into The canvas (beside Priorities), the toggles and Canvas defaults with the
  sync rule into Repositories and configuration (the Konfiguration dialog), the suggestion into the
  naming text under Creating cards, the stored fields into Data; decisions with their dates
  (Fibonacci steps and owner-only labels by the owner, suggestion borders matching proposal cards); then
  remove this plan doc.

## Boundaries

W1 comes first; W2, W3 and W4 build on it and can land in any order (W3 reads W4's toggles and
treats a canvas without them as all on). W5 needs only W1. W6 closes the project. The lists are
fixed: no editing per repository or canvas for now. The labels change neither the queue's order nor
what starts first, and agents are not told of them. The Obeya site's documentation of the
complexity scale comes later, outside this plan. Risks to watch in W3: the latency and cost of the
extra session at start (kept to one short call, skipped when nothing is left to suggest).
