import type { CardContent, FlashDirection } from '../types';
import { hostOf } from '../api';
import { pronounce, pronounceSentence } from '../speech';
import { cardMeaning, maskWord, splitAround } from '../study/answers';
import { Icon } from './Icon';

const langLabel = (c: CardContent) => (c.language === 'ja' ? 'Japanese' : 'English');

// A word typed in by hand has no source worth a line, so the front simply drops it.
function Source({ card }: { card: CardContent }) {
  const title = card.front.pageTitle && card.front.pageTitle !== 'Added by hand' ? card.front.pageTitle : card.front.url ? hostOf(card.front.url) : '';
  if (!title) return null;
  return <div className="source">From <span className="source-title">{title}</span></div>;
}

export function SpeakButton({ onClick, label, size = 18 }: { onClick: () => void; label: string; size?: number }) {
  return <button type="button" className="icon-btn speak" onClick={(e) => { e.stopPropagation(); onClick(); }} aria-label={label} title={label}><Icon name="volume" size={size} /></button>;
}

// A direction only changes what is asked; when a card has no sentence, "context" falls back to the word.
export function effectiveDirection(card: CardContent, direction: FlashDirection): FlashDirection {
  if (direction === 'context' && !card.front.cloze) return 'word';
  if (direction === 'meaning' && !cardMeaning(card)) return 'word';
  return direction;
}

export function CardFront({ card, direction = 'word' }: { card: CardContent; direction?: FlashDirection }) {
  const dir = effectiveDirection(card, direction);
  const ja = card.language === 'ja';
  const definition = card.back.definitionEn && card.back.definitionEn !== cardMeaning(card) ? maskWord(card.back.definitionEn, card) : '';
  return (
    <div className={`card-face front${ja ? ' ja' : ''}`}>
      <div className="hint">{[langLabel(card), card.back.partOfSpeech, card.back.level].filter(Boolean).join(' · ')}</div>
      <div className={`front-main dir-${dir}`}>
        {dir === 'word' && (
          <>
            <div className="front-word">{card.lemma}</div>
            {/* how it sounds belongs with the form, before the meaning is revealed */}
            <div className="front-say">
              {!ja && card.ipa && <span className="ipa">{card.ipa}</span>}
              <SpeakButton size={22} label="Play pronunciation" onClick={() => pronounce(card.lemma, card.language, card.audio)} />
            </div>
          </>
        )}
        {dir === 'meaning' && (
          <>
            <div className="front-label">What's the word?</div>
            <div className="front-meaning">{cardMeaning(card)}</div>
            {definition && <div className="muted front-definition">{definition}</div>}
          </>
        )}
        {dir === 'context' && (
          <>
            <div className="front-label">Which word is missing?</div>
            <p className="cloze">{card.front.cloze}</p>
          </>
        )}
      </div>
      <div className="front-foot"><Source card={card} /><div className="tap-hint"><Icon name="flip" size={13} />Tap to flip · hold to peek</div></div>
    </div>
  );
}

function Highlight({ text, word, card }: { text: string; word: string; card: CardContent }) {
  const parts = splitAround(text, word) || splitAround(text, card.lemma) || splitAround(text, card.surface);
  return <span>{parts ? <>{parts[0]}<mark>{parts[1]}</mark>{parts[2]}</> : text}</span>;
}

// word -> pronunciation -> meaning -> one sentence. Everything else waits behind "More details",
// so the card reads the same whether the word came from an article or was typed in by hand.
export function CardBack({ card, compact = false }: { card: CardContent; compact?: boolean }) {
  const b = card.back;
  const ja = card.language === 'ja';
  // Exactly one sentence on the card: the one the learner actually met wins, the AI example fills in.
  const lede = card.front.sentence
    ? { kind: 'context' as const, text: card.front.sentence, word: card.front.answer, vi: b.sentenceVi, label: 'Where you met it', icon: 'book' as const }
    : b.example
      ? { kind: 'example' as const, text: b.example, word: card.lemma, vi: b.exampleVi, label: 'AI example', icon: 'sparkles' as const }
      : null;
  const spareExample = lede?.kind === 'context' ? b.example : '';
  const hasMore = !compact && (!!b.notes || !!spareExample || b.collocations.length > 0 || b.synonyms.length > 0 || b.wordFamily.length > 0);
  const emptyState = !lede && !compact;
  return (
    <div className={`card-face back${ja ? ' ja' : ''}${compact ? ' is-compact' : ''}`}>
      <div className="back-head">
        <div className="answer-row">
          <span className="answer">{card.lemma}</span>
          {card.reading && <span className="reading">【{card.reading}】</span>}
          <SpeakButton label="Play pronunciation" onClick={() => pronounce(card.lemma, card.language, card.audio)} />
        </div>
        {((!ja && card.ipa) || b.partOfSpeech) && <div className="sub-row">{!ja && card.ipa && <span className="ipa">{card.ipa}</span>}{b.partOfSpeech && <span className="part-of-speech">{b.partOfSpeech}</span>}</div>}
      </div>
      <div className="back-meaning">
        <div className="meaning">{b.meaning || '—'}</div>
        {b.definitionEn && !compact && <div className="muted definition">{b.definitionEn}</div>}
        {!b.meaning && b.quickDict.slice(0, 2).map((d, i) => <div key={i} className="muted small">{d.pos}: {d.terms.join(', ')}</div>)}
      </div>
      {lede && (
        <div className={`sentence-lede is-${lede.kind}`}>
          <div className="sentence-box">
            <div className="sentence-row"><Highlight text={lede.text} word={lede.word} card={card} /><SpeakButton label="Listen to the sentence" onClick={() => pronounceSentence(lede.text, card.language)} /></div>
            {lede.vi && <div className="muted context-translation">{lede.vi}</div>}
          </div>
          {!compact && <div className="sentence-origin"><Icon name={lede.icon} size={12} />{lede.label}</div>}
        </div>
      )}
      {emptyState && (
        <div className="sentence-lede is-empty">
          <Icon name="sparkles" size={15} />
          <span>{card.enrichmentStatus === 'pending' || card.enrichmentStatus === 'processing' ? 'An example sentence is on its way.' : 'No example sentence for this word yet.'}</span>
        </div>
      )}
      {hasMore && (
        <details className="more">
          <summary>More details<Icon name="chevronDown" size={16} /></summary>
          {b.notes && <div className="block"><div className="block-label">When to use it</div><div className="usage-note">{b.notes}</div></div>}
          {spareExample && <div className="block"><div className="block-label">AI example</div><div>{spareExample}</div>{b.exampleVi && <div className="muted">{b.exampleVi}</div>}</div>}
          {b.collocations.length > 0 && <div className="block"><div className="block-label">Collocations</div><div className="chips">{b.collocations.map((c) => <span key={c}>{c}</span>)}</div></div>}
          {b.synonyms.length > 0 && <div className="block"><div className="block-label">Synonyms</div><div className="chips">{b.synonyms.map((c) => <span key={c}>{c}</span>)}</div></div>}
          {b.wordFamily.length > 0 && <div className="block"><div className="block-label">Word family</div><div className="chips">{b.wordFamily.map((c) => <span key={c}>{c}</span>)}</div></div>}
        </details>
      )}
      {!compact && <div className="back-foot"><span className="tap-hint"><Icon name="flip" size={13} />Tap to flip back</span></div>}
      {(card.enrichmentStatus === 'pending' || card.enrichmentStatus === 'processing') && !emptyState && <div className="pending-note"><Icon name="sparkles" size={13} />AI explanation is still on its way.</div>}
    </div>
  );
}
