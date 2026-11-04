## Card lifecycle

A chapter of the [design doc](../design.md), whose header says how it is written.

A card is created by the owner (voice or canvas) or proposed by an agent, worked on by a worker,
handed over with a demo, approved, and lands; finished cards go to the archive.

### Proposals

A worker proposes a card with `propose_card` (see A worker's tools). Its text is written for the
agent that will take the card on, as the owner would write a card (no "I", other cards named by
their title). Apart from it come a reason, for the owner only, beside the card that proposed it, and
what the owner has to decide, as questions with options. The owner can edit the proposal and pick
options on it. „Übernehmen und starten“ starts it like a started planned card, through the
Koordinator; „Übernehmen“ only plans it. Accepting writes the questions into the text, picked ones
under „Entschieden:“, the rest under „Offene Fragen:“, so the new worker reads what is settled and
asks the rest.

Obeya proposes cards of its own too („Vorschlag von Obeya“): the Arbeitsrückschau's, and the card
that fills in the settings of a repository that has none (see Leinwände).

A proposed idea ("✦ Vorschlag · Idee") is for something to think through first: „Übernehmen und
besprechen“ makes it an open idea whose exploration agent opens the discussion with the text and its
questions; „Als Aufgabe übernehmen“ plans it as a task. „Als Idee besprechen“ on a proposed task
makes it an open idea the same way, whose agent hears that it was proposed to be built and the owner
wants to think it through first; by voice, „erst als Idee besprechen“.

#### A proposal that starts later

A follow-up that can only be done later (whether a bank has registered a form, two weeks on) is a
proposal with a start time (`start_at`), not a sentence in a handover where it goes under. The owner
decides on it now, and the card starts by itself at the time. The time stands under the proposal's
text with „Ändern“ (the „Später …“ menu, with „Ohne Zeitpunkt“), and on the canvas card after its
state („startet …“). Its one button, „Übernehmen“, plans the card and snoozes it until then, the
proposal's reason as what it does then; at the time it starts like a started planned card (see
Snoozing a card), at once if the time has passed. Its worker hears when the card was set to start
and that it is that time now, so "in two weeks" reads as due; it checks what it can and asks the
owner for what only they can see. A rework keeps the time; accepting only as planned, or as an idea,
drops it. Starting after another card is done is the plan's order, not this.

#### A proposal its agent takes back

A worker takes back its own proposal with `withdraw_proposal`, or replaces it with `propose_card`'s
`replaces`, naming it by title (Obeya matches the card's latest proposal of that title, case, quotes
and markdown aside, and otherwise answers with the list of its proposals). A proposal still open goes
from the canvas at once, also mid-rework, and the proposing card's conversation says so. It is kept
as deleted with the mark, so the Rückschau does not read it as dismissed by the owner. One the owner
accepted already is only marked until it is finished: its card reads „Ersetzt durch „…““ or „Vom
Agenten zurückgezogen“ and needs the owner, and its panel says by what and why, with „Entfernen“ (as
„Löschen“, with an undo) and „Behalten“. A finished card stays as it is.

#### Merging a proposal with a card

A proposal that belongs with another card, the owner's planned task or another proposal, is merged
with it: „Zusammenführen mit …“ among the proposal's buttons opens a picker of the cards it can be
merged with (tasks on the canvas nobody has worked on yet, not snoozed, not themselves merged or
reworked, their repository running; never a proposed idea, nor from a snoozed proposal), the newest first, with a search over titles and texts. Picked, the
two stand on the canvas as one card twice as wide, the proposal on the left, the other card on the
right, glued by a knot that spins while a read-only agent in the other card's repository writes one
card of both (title and text; questions stay questions). The pair goes to the nearest free spot by
the other card. Meanwhile neither needs the owner and both refuse everything but „Trennen“ (and
dismissing the proposal); the other card's own panel says it is being merged.

Once the merged card is there the pair needs the owner (the pin, „Braucht dich“). Its panel shows
the two cards side by side on top and the merged card under them, centred, with „Zusammenführung
übernehmen“ and „Trennen“. Approving gives the other card the merged title and text, the
screenshots of both and the pair's place; a proposal also keeps the questions of both, a planned
task gets the proposal's questions as open ones in its text, as accepting does. The proposal goes,
kept as deleted with a mark so the Rückschau does not read it as dismissed, and what followed up on
it follows up on the other card. „Trennen“ leaves both as they were, side by side where the pair
stood. An agent that ends without a merged text leaves the reason in the panel, with „Nochmal
versuchen“; a merge cut off by a restart starts again.

Decision (2026-11-04): the merged text waits for the owner rather than replacing the card at once,
since an agent's summary may drop or blur what either card asked for; and only cards nobody has
worked on can be merged, so no worker's task changes under it. Merging into a new third card was
rejected: the owner's card, with its place, group and arrows, is what stays.

#### Reworking a proposal by words

Instead of editing a proposal by hand, the owner may say or type what should change (its field „Was
soll anders werden?“). With the proposal open, the words go straight to a read-only agent of its own
in the card's repository, the reviser, without the Koordinator or an undo window. It rewrites title,
text, reason and questions by those words and keeps the rest; a question the words settle goes, its
decision into the text. What the words ask of Obeya (accept or dismiss it, a rule, another card) it
passes on with `to_obeya` (an accept passed on that way waits for the rework, as the button does);
what they only ask („Was würdest du nehmen?“) it answers, leaving the
proposal as it was. Words about a proposal that is not open go to the Koordinator.

Screenshots with the words (see Screenshots) reach the reviser along with those already on the
proposal and those shown earlier in its conversation (at most twelve, newest first); it names those
that go with the task (dropping one it kept before, if the words make it obsolete), which then show
with the proposal's text and are the task's once accepted.

The conversation stands beside the proposal as on an idea, its open questions at the end, a settled
question where it was asked (see The conversation). Options picked and sent („Antworten“) go to the
reviser at once; accepting instead takes the picks into the text. While the rework runs the proposal
shows „Wird überarbeitet“ (on the canvas card in place of its state, which the kind line already
names), cannot be edited or accepted with „Übernehmen“ alone, and does not count
as needing the owner; words said meanwhile wait for the next rework. Then the conversation shows the
reviser's reply, „Vorschlag überarbeitet.“ when the text changed, and any new questions. A reviser
that ends without a text leaves the proposal as it was, with the error; a rework running at a
restart starts again.

„Übernehmen und starten“ (and „Übernehmen und besprechen“, „Als Idee besprechen“) does not wait for
the rework, like "So bauen" on an idea: clicked during one, the proposal is accepted once the new text
is there, unless it still has questions, in which case it stays a proposal and the conversation says
why. Meanwhile the button reads „Startet nach der Überarbeitung …“ with „Doch nicht übernehmen“, and
the canvas card's state line adds „danach übernommen“. Accepting by voice during a rework is refused (see Commands
to the Koordinator).

### At work

`working`: the worker leases a workspace, implements, runs the checks the repository's settings name,
and records the demo.

### Waiting for approval

`waiting: demo`: the card carries the demo (see The demo on the card); the owner approves or gives
feedback. Whatever the owner writes or says on the card goes to the worker at once, and the work
still waits for approval: while the worker takes the words in, the card is at work („Agent arbeitet
an deiner Nachricht“, not counted as needing the owner), „Freigeben“ stays, and a change the words
call for comes as a new handover. Words asking Obeya for something (gib frei, a follow-up) the worker
passes on with `to_obeya`.

When the turn ends, the card is the owner's again. Without a new demo it reads „Agent hat
geantwortet, wartet auf dich“ instead of „Demo bereit“; a new demo reads „Demo bereit“ again. Only
words for the owner count as an answer (a reply, what the worker says, Obeya's result of
`to_obeya`), from this turn; an answer to earlier words does not count. A turn that ends without any
(an error, the session ended) leaves the card at „Demo bereit“, and the conversation says the agent
stopped without answering. A turn that ends with words for the owner while only the app it serves
for them to try runs on also gives the card back: only that app shows as running. Background work
the worker waits for (a test run, a render it said a new handover waits for) keeps the card at work
until it wakes the worker and its turn ends, words or not, and so does any background work after a
turn without such words. The app is what the worker started in the turn in which it said the app
runs (`app_running`) and still runs then: nothing else tells the two apart, so a worker names the app
again each time it starts it anew.

A question in the demo report is an open question like a worker's (see Questions go to the owner),
with its options and the worker's pick.
The card's one field (see The conversation) takes the answer and feedback together; the worker hears
them as the answer, and the card is at work while it takes them in, as after feedback. A restart
resumes that turn like a working card's.

#### The handover report

The worker's summary is its handover in the card's conversation, not repeated under the demo: the
first says what changed for the user and what the owner needs to know, in a few short paragraphs at
most; a later one only what the conversation has not said yet, often a sentence. A reply to a note
that changes nothing ends the turn by itself, without a new handover. Whoever reads the card's report
outside its conversation (a follow-up's worker, the Koordinator, a prototype's idea, a shared page)
gets the whole of it: the first handover, then „Danach im Gespräch:“ with the replies and later
handovers in order. A problem beyond the task is a proposal, not a line in the report.

### Approval and landing

Where work lands through pull requests, the approve button reads "Freigeben (PR)": the card goes
`in PR`, its worker opens the PR (until then „Freigegeben · Agent öffnet den PR“), and Obeya carries
it through to the merge, which it does itself unless the settings leave the merge to people on the
forge (see PR loop).

Where the settings allow it (`direct`), "Direkt auf main" beside it pushes the work onto the
default branch without a pull request, review or the PR's CI (see How work lands); only the button
does, never words to the Koordinator. Where work lands on `main`, approval lands it at once.

A review card, a contributor's pull request (see Review cards), reads „Mergen (PR #5)“: Obeya merges
the head its worker reviewed, and the card is `live`; while a change request waits for the
contributor it is `in PR`, „Wartet auf Beitragenden“.

An approve click folds the card at once without waiting for the server: the canvas card says what is
under way („wird freigegeben …“, „wird direkt auf main gepusht …“), no longer counts as needing the
owner and is skipped by Tab, which goes on from the place of the card it opened last. A message with
a spinner stands above the microphone, which the answer turns into the confirmation or, when the
landing is refused, into the reason, with the card waiting for review again; a restart that cut the
landing off gives the card back the same way.

#### Feedback after approval

Once an approval of an agent's work has gone through (the card's button, the one-click approval in
„Braucht dich“ on the canvas and the phone, work that changed nothing included), a prompt stands
above the microphone: „Wie gut hat der Agent „…“ erledigt?“ with five stars (Schlecht, Mäßig, In
Ordnung, Gut, Hervorragend) and „Überspringen“. A star saves the rating at once; then a comment
field opens, optional, and „Überspringen“ becomes „Fertig“. The prompt stays until answered or
skipped; another approval asks about its own card instead. Skipping records nothing: the card keeps
asking. Every approved card (`approved`, `in PR`, `live`, `done`, archived too) whose latest
handover has no response shows the same stars and comment under its conversation, and once answered
shows the answer there to change; an unsent comment is a draft of the card's like any other. Saving
goes its own way: approval and landing never wait for it, and a refused save shows its reason in the
prompt, the approval standing. A response is about the latest handover (see Models and effort in
Agents and workspaces); approved again for the same handover (a retried landing), nothing new is
asked once answered; work handed over anew asks afresh. Review cards of contributors' pull requests
and prototypes are not asked about. „Feedback nach der Freigabe“ in Konfiguration → Benachrichtigungen und Limits turns
the asking off and on for every open page at once; turned off, no card asks or shows a rating, and
the responses given stay.

#### Comparing ratings

„Bewertungen vergleichen“ (beside „Feedback nach der Freigabe“ in the Konfiguration, and
under the stars of every rated card; the logo's menu has it as „Agentenleistung“) opens „Agentenleistung“ over the page, as the configuration
is: every response on every canvas (`/api/feedback`), grouped by whom it credits (see Models and
effort in Agents and workspaces). Each harness heads its rows, one per model and effort, the model
as the session resolved it and an unknown field named unknown; work by several configurations
(„Mehrere Konfigurationen“) and work nothing was recorded of („Nicht erfasst“) have rows of their
own under „Keinem Modell allein zugeordnet“, never counted for a model. Rows are ordered by harness,
model and effort, never by score. Each says how many ratings it rests on, their average and
comments; a row with fewer than five ratings is greyed and tagged „wenige“. The main view shows
each row's ratings split by stars as one bar („Verteilung“); „Jede Bewertung“ draws each rating as a
dot on the scale from 1 to 5 with the median as a line, the dots of one rating scattered in a cloud
that grows with their number (the same at every render), each dot the larger the newer its rating, in
five steps: up to three days, a week, a month, two months, older; „Im Zeitverlauf“ puts above the table each
model and effort's average per month as a line (from the first month with a rating to the last), a
month of fewer than five ratings a hollow point, work credited to no one model without a line. The
view chosen is kept per browser. With
fewer than five ratings in all (after the filters), there is no table and no average, only the
responses so far, each with whom it credits. The head counts responses, ratings and those credited
to no one model. Filters: canvas, repository and project (each only where there is more than one to
choose, a project as soon as there is one), and the period (all, the last 90 or 30 days, by when a
response was last given). A click on a row lists its responses, the latest first: the card's title
as it was (a link to the card: on this canvas it closes the dialog and opens the card, archived
ones from the archive; on another, its address), project, repository, canvas where they differ,
date, stars and comment, and for mixed work the configurations that did it. A deleted card's
response still counts and says so, its title without a link. Closed and opened
again, the dialog keeps its filters and open row; it holds the keyboard's focus while open and
gives it back to what opened it. A response with only a comment counts as a
response, not a rating. The phone view has no dashboard.

„Feedback-Log: jede Antwort nach Zeit“ in the dashboard's head leads to the Agent Feedback Log, a
page of its own in place of the canvas (`/c/<canvas>/feedback`), with the dashboard's filters as they
were; its link „← Agentenleistung“ leads back to that canvas with the dashboard open and the filters
the two share, and so does the browser's Back. A page rather than a view in the dialog: a long list
of responses wants the whole screen, and an address of its own keeps it across a reload and makes it
a link (2026-11). It lists every response on every canvas, the newest first (by when it was last
given), each with its date, card (a link to it, opening on its canvas, archived ones from the
archive; a deleted card's title without one), stars („ohne Sterne“ for a comment alone), comment,
whom it credits (for mixed work „Mehrere Konfigurationen“ with the configurations that did it),
project, repository and canvas. Filters: the dashboard's (period by when a response was last given),
then harness, model and effort of the credited configuration (each where there is more than one to
choose, an unknown value named unknown), which work credited to no one configuration never matches,
and rating, whole stars or „ohne Sterne“. Grouping: none, configuration (in the dashboard's order,
mixed and unrecorded work last), project, repository, canvas (by name, those without one last),
week (from Monday) or month (the newest first); each section heads its responses with their count
and average, and the column it groups by gives way to that heading. The head counts the responses
shown of all. With no responses at all it says what fills it; when the filters leave nothing, it
says so with „Filter zurücksetzen“. Filters and grouping stay in the address. Every control is a
link, a select or a button, in reading order for the keyboard.

### Live and done

Merged (or landed on `main`) → `live`. The demo stays on the card. The worker hears that its work is
on main and may finish what waited for that (see After landing).

Work that changed nothing in the repository (a demo, an analysis, an answer) has nothing to land:
when the handover finds no commits of the card's own (measured as in The Koordinator) and nothing
uncommitted, the button reads "Beenden" with a line that no pull request follows, and approving makes
the card `done` ("Erledigt"). The handover's answer tells the worker what the button will do, as
Obeya sees the branch: close the card, or land the files it names. A worker knows the commits it made,
not those its branch carried from before, and otherwise told the owner the opposite of what the card
showed. A worker whose
branch emptied after the approval closes the card with `close_unchanged`, refused while the
workspace holds changes.

A finished card an agent worked on keeps its field: a question there resumes that agent (see
Questions after the work).

### Archive

The owner archives a finished card ("Archivieren" on it, its archive button on the canvas, or all
finished ones at once in the archive); a prototype goes there when it ends (see Prototypes). A
stopped task („Gestoppt“) can be archived one at a time, for the owner to come back to, beside „Neu
starten“ and „Löschen“; not while it waits to start, nor while its workspace holds work that has not
landed, or a clone keeps its branch since its workspace was taken (the button is greyed and says
why), which would lie unseen in a clone. A stopped card opens
like a card an agent worked on, the task as its conversation's first message.

The archive (its button in the bar, or `A`) drops down like the queue: archived cards on a timeline
by day, newest first, labelled with their kind or state unless plain tasks. One unfolds as on the canvas and can go
back to its place; an ended prototype only shows, read-only, how it ended. A search field, focused on
opening and kept between openings, filters by every typed word (case and accents aside) in title,
text, summary, last status or label, and a project's goal and workstreams, marking the words in the
titles. The list stays under the dim while a card from it is open, so the card folds back into it.

### Projects end

A project ends when every workstream in its plan doc is ticked on the default branch, or when the
doc is deleted: it moves into the archive with its workstreams, which are not listed on their own. A
workstream still at work then (or its worker finishing after the landing) keeps the project on the
canvas until that worker is done. Opened from the archive, its sheet shows read-only the goal and
workstreams as the doc last stood, each workstream with its conversation and demo. When the file
comes back, or gets an open workstream, the project returns to its place.

Every project's sheet holds its conversation with its project agent (see Asking in a project's
sheet), lists its decisions and links the idea or task its plan doc came from (see Deciding).

### Decisions

- **The dashboard compares without ranking** (owner, 2026-11-03): ratings are the owner's judgement
  of single tasks, whose difficulty and kind count too, so rows keep a fixed order, always show how
  many ratings they rest on, and below five ratings in all give no averages. The owner chose the
  table with each row's spread of stars as the main view, beside it the dots of each rating and the
  trend per month, whose sparse months are drawn hollow rather than left out. Rejected: sorting by
  average (it reads as a ranking the numbers cannot carry); recommending a model from the ratings, which is for
  [Choosing an agent for a task](../plan/agent-choice.md) to take up.

- **Feedback is five stars and an optional comment, asked after the approval and never in its way**
  (owner, 2026-11-03): five steps give comparisons between models enough range, the comment says
  why. The rating is kept off the approve button so approving never waits for an opinion. Rejected:
  thumbs up or down (too coarse to compare), a required rating, a prompt that ends with the
  confirmation's few seconds (the card keeps asking instead).

- **A proposal is written for the next worker, with its reason and questions apart.** Rejected: one
  first-person text with the questions buried in it, which went to the next worker as if the owner
  had written it.
- **A proposal the owner talks about is rewritten by an agent of its own** (2026-10-06). Rejected:
  the proposing worker (may be gone or busy) and the Koordinator's quick turn (a whole card text
  would slow every confirmation).
- **On an open proposal, the owner's words go straight to its reviser** (2026-10-14), as on any card
  with an agent. Rejected: the Koordinator reading them first, which delayed the rework by the undo
  window.
- **The reviser replies, and a settled question stays where it was asked** (2026-10-14). Rejected:
  a silent reviser, after which the owner who asked about a question saw neither it nor an answer.
- **Accepting a proposal does not wait for its rework** (2026-10-06): whoever answered the last
  question knows starting comes next. Rejected: a disabled button.
- **An agent takes back its own proposal** (2026-10-17): an accepted one is only marked, since the
  owner chose it and work may be under way. Rejected: a new proposal saying it replaces an older one;
  the owner started both.
- **A follow-up due later is a proposal with a start time** (2026-10-21), so it does not go under in a
  handover. Rejected: the proposal coming back at the time (the owner decides twice); the worker's
  card staying snoozed after its handover (the approval would hang for weeks); a calendar entry (it
  only reminds, where the card's agent can check part of it itself).
- **A proposed task can be taken as an idea** (2026-10-16), to discuss and prototype it first.
  Rejected: only the proposing worker deciding whether a proposal is an idea.
- **Feedback keeps the approval** (2026-10-08): the owner's words reach the worker at once and the
  approval stays at hand. Rejected: sending the card back to `working` until the next handover,
  which took the approval away and held the feedback for „Rückgängig“ like a command.
- **Only words for the owner count as an answer** (2026-10-19). Rejected: counting any end of a
  turn, which left „Agent hat geantwortet“ under a question no agent had seen.
- **An answer given while only the app it started runs on gives the card back** (2026-10-28,
  narrowed 2026-10-29). Rejected: keeping the card at work as long as any background work of that
  turn ran, which showed an agent at work on the owner's words for hours while only the test server
  it had restarted for them ran; and giving the card back whatever background work ran, which read
  „wartet auf dich“ while the tests and render the agent had said it would hand over after still
  ran. The app is told apart by `app_running` rather than by the work's duration or the agent's
  words: the SDK says neither which task serves what nor whether the agent waits for it.
- **A demo a worker reworks after an answer is at work, not the owner's** (2026-10-07). Rejected:
  keeping the badge, where a worker paused for a restart was never resumed.
- **A later handover says only what is new; a reply that changes nothing ends the turn**
  (2026-10-15, 2026-10-16): the owner has the rest in the conversation. Rejected: calling the
  summary the whole report, and a reply that told the worker to carry on; both made handovers repeat
  the reply just before them.
- **An approve click folds the card at once.** Rejected: the card staying open with no sign of the
  click until the push was through.
- **Work without a change ends in `done`, not `live`** (2026-10-02). Obeya reads it from the
  workspace, not from the worker's word. The owner still approves it: its demo or summary is the
  result. Rejected: waiting in `in PR` for a PR that never comes.
- **A finished card keeps a field for questions to its agent** (2026-10-08).
- **What the owner archives**: only their own finished cards, ideas once parked or dropped (a parked
  idea's result may have been used outside Obeya, 2026-10-15), and stopped tasks (2026-10-15).
  "All finished ones at once" leaves ideas alone; a workstream goes with its project. Archiving
  keeps the card's position, demo and log.
- **No card goes into the archive while its worker finishes after the landing** (2026-10-16):
  workers are looked up among the cards on the canvas, so the worker of an archived card never ended
  its turn and held its clone out of the owner's sight.
