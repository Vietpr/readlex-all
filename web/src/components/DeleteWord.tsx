// Deleting a word is the only way to get it out of Today and out of its daily set, so the button
// belongs everywhere a word is listed — not just on the word's own page.
import { useState } from 'react';
import { api } from '../api';
import { Icon } from './Icon';

export function confirmDeleteWord(lemma: string): boolean {
  return confirm(`Delete “${lemma}”?\n\nIt disappears from Today, from its daily set and from every set, together with its sentences and review history. This cannot be undone.`);
}

export function DeleteWordButton({ id, lemma, onDeleted, onError }: { id: string; lemma: string; onDeleted: () => void; onError?: (message: string) => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button" className="icon-btn danger" disabled={busy}
      aria-label={`Delete ${lemma}`} title="Delete this word everywhere"
      onClick={async (e) => {
        e.stopPropagation();
        if (!confirmDeleteWord(lemma)) return;
        setBusy(true);
        try { await api.deleteWord(id); onDeleted(); } catch (err) { onError?.((err as Error).message); } finally { setBusy(false); }
      }}
    >
      <Icon name="trash" size={16} />
    </button>
  );
}
