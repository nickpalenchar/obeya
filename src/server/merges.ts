// A proposal merged with another card by the owner („Zusammenführen mit …“): an agent writes one
// card of both in one read-only turn, and the two wait for the owner to approve it or separate them.

import { z } from 'zod';
import { ownersLanguage } from '../core/locale';
import { messageOf } from '../core/text';
import type { Item } from '../core/types';
import type { Board } from './board';
import { readSession } from './koordinator';
import type { AgentRuntime } from './runtime';
import { proposalTask } from './workers';

export interface MergeOptions {
  board: Board;
  runtime: AgentRuntime;
  /** The checkout the agent may read in: the repository of the card that stays. */
  pathFor: (card: Item) => string;
  preferences?: () => string;
}

export class Merges {
  /** Proposals being merged, so a resume does not start a second agent. */
  private busy = new Set<string>();

  constructor(private o: MergeOptions) {}

  /** The owner merges proposal `cardId` with card `withId`: an agent writes the merged card. */
  merge(cardId: string, withId: string) {
    this.o.board.mergeStart(cardId, withId);
    this.run(cardId);
  }

  /** After a restart: merges whose agent had not finished start again. */
  resume() {
    for (const i of this.o.board.items()) if (i.state === 'proposal' && i.proposal?.merge && i.proposal.merge.task === undefined && i.proposal.merge.failed === undefined) this.run(i.id);
  }

  private run(cardId: string) {
    if (this.busy.has(cardId)) return;
    const card = this.o.board.item(cardId);
    const other = card?.proposal?.merge && this.o.board.item(card.proposal.merge.with);
    if (!card || !other) return;
    this.busy.add(cardId);
    this.ask(card, other)
      .then(
        (r) => void this.o.board.merged(cardId, r),
        (e) => void this.o.board.merged(cardId, { failed: messageOf(e) }),
      )
      .catch((e) => console.error('merge:', e))
      .finally(() => this.busy.delete(cardId));
  }

  private async ask(card: Item, other: Item): Promise<{ title: string; task: string }> {
    let merged: { title: string; task: string } | undefined;
    const error = await readSession(this.o.runtime, {
      cwd: this.o.pathFor(other),
      role: 'koordinator',
      at: { card: card.id },
      onLimit: (until) => this.o.board.waitsForLimit({ card: card.id }, until),
      system: [SYSTEM, this.o.preferences?.() ?? ''].filter(Boolean).join('\n\n'),
      tools: (finish) => [
        {
          name: 'merge_cards',
          description: [
            `The one card both become, in the owner's language. ${ownersLanguage(this.o.board.conversation())}`,
            `title: short and precise, covering what both are about. ${proposalTask('either card nor this conversation')}`,
          ].join(' '),
          schema: { title: z.string(), task: z.string() },
          run: (r) => {
            if (merged) return 'Only the first one counts.';
            const title = String(r.title).trim();
            const task = String(r.task).trim();
            if (!title || !task) return 'Not recorded: title and task must not be empty.';
            merged = { title, task };
            return finish('Recorded. End your turn now.');
          },
        },
      ],
      brief: this.message(card, other),
    });
    if (merged) return merged;
    if (error !== undefined) throw new Error(error);
    throw new Error(this.o.board.language() === 'de' ? 'der Agent hat keinen zusammengeführten Text geliefert' : 'the agent gave no merged text');
  }

  private message(card: Item, other: Item): string {
    const describe = (i: Item, what: string) =>
      [
        `${what}:\n\n<title>${i.title}</title>\n\n<task>\n${i.body}\n</task>`,
        i.proposal?.reason ? `Why it was proposed (for the owner only): ${i.proposal.reason}` : '',
        i.proposal?.questions.length ? `Its questions to the owner, which stay questions and do not go into the text:\n${i.proposal.questions.map((q) => `- ${q.text}`).join('\n')}` : '',
      ]
        .filter(Boolean)
        .join('\n\n');
    return [describe(card, 'The proposal an agent made'), describe(other, other.state === 'proposal' ? 'The other proposal it is merged with' : "The owner's planned card it is merged with")].join('\n\n---\n\n');
  }
}

const SYSTEM = `
You merge two cards on Obeya, a canvas on which the owner directs coding agents: an agent proposed a card, and the owner found that it belongs together with another card. Write the one card both become: what either asks for goes in, once, in the words of the cards where they say the same; where they differ, both go in as parts of the one task; nothing goes in that neither says. The card's text is all the agent who takes it on gets, so it must stand on its own and not mention that it was merged. Read in the repository only where the cards' texts need it (a file, a name they mention). Then call merge_cards once and end your turn. You cannot change files.
`.trim();
