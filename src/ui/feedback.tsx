// The owner's feedback on an agent's approved work: 1 to 5 stars and an optional comment, the same
// on the canvas and on the phone. Right after an approval it asks above the microphone, where the
// owner can skip it; the card itself keeps asking until it is answered, and shows the answer after.
// Saving goes its own way: approval and landing never wait for it, nor fail with it.

import { useContext, useEffect, useState } from 'react';
import type { FeedbackAnswer, Item } from '../core/types';
import { api } from './api';
import { dropDraft, rateDraft, updateDraft, useDraft } from './draft';
import { plain } from './markdown';
import { OpenPerformance } from './performance';
import { failText, t } from './strings';

/** Stars and the comment for the card's approved work; `prompt`: the one after the approval, with its title and „Überspringen“. */
export function Rate({ item, prompt, onClose }: { item: Item; prompt?: boolean; onClose?: () => void }) {
  const rate = item.rate!;
  const key = rateDraft(item.id);
  const draft = useDraft(key);
  // what was saved, ahead of the snapshot that brings it
  const [saved, setSaved] = useState<FeedbackAnswer | undefined>(rate.answer);
  const [hover, setHover] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [thanked, setThanked] = useState(false);
  const compare = useContext(OpenPerformance);
  useEffect(() => setSaved(rate.answer), [rate.handover, rate.answer?.rating, rate.answer?.comment]);
  const rating = saved?.rating ?? 0;
  const give = async (answer: FeedbackAnswer) => {
    const before = saved;
    setSaved(answer);
    setBusy(true);
    setError('');
    try {
      await api.giveFeedback(item.id, rate.handover, answer);
      setThanked(true);
      return true;
    } catch (e) {
      setSaved(before);
      setError(failText(e));
      return false;
    } finally {
      setBusy(false);
    }
  };
  const text = draft.text.trim();
  const sendComment = async () => {
    if (!text || busy) return;
    if (await give({ ...(saved?.rating ? { rating: saved.rating } : {}), comment: text })) {
      dropDraft(key);
      onClose?.();
    }
  };
  // the comment field opens with the first star, or stands where a comment was given or begun
  const commenting = rating > 0 || !!saved?.comment || !!draft.text;
  const shown = hover || rating;
  return (
    <div className={prompt ? 'rate prompt' : 'rate'}>
      <div className="rate-row">
        <span className="rate-q">{prompt ? t.feedback.ask(plain(item.title)) : t.feedback.askCard}</span>
        <span className="stars" role="radiogroup" aria-label={t.feedback.askCard} onMouseLeave={() => setHover(0)}>
          {t.feedback.stars.map((name, n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={rating === n + 1}
              aria-label={t.feedback.star(n + 1, name)}
              title={name}
              className={n < shown ? 'star on' : 'star'}
              disabled={busy}
              onMouseEnter={() => setHover(n + 1)}
              onClick={() => rating !== n + 1 && void give({ rating: n + 1, ...(saved?.comment ? { comment: saved.comment } : {}) })}
            >
              {n < shown ? '★' : '☆'}
            </button>
          ))}
        </span>
        {shown > 0 && <span className="rate-name">{t.feedback.stars[shown - 1]}</span>}
        {prompt && (
          <button type="button" className="btn rate-skip" title={rating || text ? undefined : t.feedback.skipHint} disabled={busy} onClick={() => (text ? void sendComment() : onClose?.())}>
            {rating || text ? t.feedback.done : t.feedback.skip}
          </button>
        )}
      </div>
      {commenting && (
        <div className="rate-comment">
          {saved?.comment && !draft.text ? (
            <p className="rate-given">
              {t.feedback.quoted(saved.comment)}{' '}
              <button type="button" className="link" onClick={() => updateDraft(key, { text: saved.comment ?? '' })}>
                {t.feedback.change}
              </button>
            </p>
          ) : (
            <>
              <textarea
                rows={2}
                placeholder={t.feedback.comment}
                value={draft.text}
                onChange={(e) => updateDraft(key, { text: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void sendComment();
                }}
              />
              {!prompt && (
                <button type="button" className="btn" disabled={!text || busy || text === saved?.comment} onClick={() => void sendComment()}>
                  {t.feedback.send}
                </button>
              )}
            </>
          )}
        </div>
      )}
      {error && <p className="p-error">{error}</p>}
      {thanked && !error && !prompt && <p className="hint">{t.feedback.thanks}</p>}
      {!prompt && rating > 0 && compare && (
        <button type="button" className="link rate-compare" title={t.performance.openHint} onClick={compare}>
          {t.performance.open}
        </button>
      )}
    </div>
  );
}

/**
 * The prompt after an approval: `ask` it for a card once the approval went through; it shows once
 * the card's approved work takes feedback and has none yet, and stays until answered or skipped.
 * Another approval asks about its own card instead.
 */
export function useRatePrompt(items: Item[]) {
  const [card, setCard] = useState<string | null>(null);
  const item = card ? items.find((i) => i.id === card) : undefined;
  // answered elsewhere (the card, another device) or no longer asked for: nothing left to ask
  const [answeredHere, setAnsweredHere] = useState(false);
  useEffect(() => setAnsweredHere(false), [card]);
  const open = !!item?.rate && (!item.rate.answer || answeredHere);
  const close = () => setCard(null);
  const prompt = open ? (
    <div className="rate-pop" onClickCapture={() => setAnsweredHere(true)}>
      <Rate item={item!} prompt onClose={close} />
    </div>
  ) : null;
  return { ask: setCard, prompt };
}
