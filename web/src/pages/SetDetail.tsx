import { useEffect, useState } from 'react';
import { api, formatSetDate } from '../api';
import { navigate } from '../router';
import { Icon } from '../components/Icon';
import { StudyActions } from '../components/StudyActions';
import { SetProgress, StatePill } from '../components/SetProgress';
import { DeleteWordButton } from '../components/DeleteWord';
import type { CardContent } from '../types';

export function SetDetail({ date }: { date: string }) {
  const [cards, setCards] = useState<CardContent[] | null>(null);
  const [error, setError] = useState('');
  const load = () => api.set(date).then((r) => { setCards(r.cards); setError(''); }).catch((err) => setError((err as Error).message));
  useEffect(() => { load(); }, [date]);
  return (
    <div>
      <button className="back-link" onClick={() => navigate('/library')}><Icon name="arrowLeft" size={16} />Library</button>
      <h1>{formatSetDate(date, 'long')}</h1>
      {error && <p className="error">{error}</p>}
      {!cards && !error && <p className="muted">Loading…</p>}
      {cards && (
        <>
          <p className="muted lead">{cards.length} {cards.length === 1 ? 'word' : 'words'} saved</p>
          <SetProgress cards={cards} />
          <StudyActions cards={cards} title={`${formatSetDate(date)} · ${cards.length} words`} returnTo={`/library/sets/${date}`} />
          <h2>Words</h2>
          <ul className="word-list card">
            {cards.map((c) => (
              <li key={c.cardId} className="with-action">
                <span className="w" onClick={() => navigate(`/library/${c.vocabularyId}`)}>{c.lemma}{c.reading ? <span className="muted"> {c.reading}</span> : null}</span>
                <span className="m" onClick={() => navigate(`/library/${c.vocabularyId}`)}>{c.back.meaning}</span>
                <span className="meta"><StatePill card={c} /></span>
                <DeleteWordButton id={c.vocabularyId} lemma={c.lemma} onDeleted={load} onError={setError} />
              </li>
            ))}
            {!cards.length && <li className="muted empty">No words were saved on this day.</li>}
          </ul>
        </>
      )}
    </div>
  );
}
