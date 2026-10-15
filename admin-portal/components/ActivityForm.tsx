'use client';

import { useActionState, useState } from 'react';
import { submitActivity, type SubmitState } from '@/app/activity/[sessionId]/actions';

const MAX = 1000;

export function ActivityForm({ sessionId }: { sessionId: string }) {
  const [state, action, pending] = useActionState<SubmitState, FormData>(submitActivity, { status: 'idle' });
  const [text, setText] = useState('');

  if (state.status === 'saved') {
    return (
      <div className="text-center" role="status">
        <svg viewBox="0 0 56 56" className="mx-auto mb-5 h-14 w-14" aria-hidden="true">
          <circle cx="28" cy="28" r="28" fill="#34c759" />
          <path d="M17 29l7 7 15-16" stroke="#fff" strokeWidth="4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <p className="text-[24px] font-semibold">Thanks.</p>
        <p className="mt-1 text-[17px] text-[var(--text-secondary)]">Your activity has been logged.</p>
      </div>
    );
  }

  return (
    <form action={action}>
      <input type="hidden" name="sessionId" value={sessionId} />
      <textarea
        name="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={MAX}
        rows={5}
        aria-label="What did you work on?"
        placeholder="e.g. Built the onboarding screen for my SwiftUI app"
        className="w-full resize-y rounded-xl border border-[var(--separator)] bg-transparent px-4 py-3.5 text-[17px] outline-none focus:border-[var(--accent)] focus:ring-4 focus:ring-[var(--focus-ring)]"
      />
      <div className="mt-5 flex items-center justify-between gap-3">
        <span className="text-[13px] text-[var(--text-secondary)]">{text.length} / {MAX}</span>
        <button
          type="submit"
          disabled={pending || text.trim().length === 0}
          className="rounded-full bg-[var(--accent)] px-6 py-3 text-[17px] text-white transition hover:brightness-110 disabled:opacity-50"
        >
          {pending ? 'Saving…' : 'Submit'}
        </button>
      </div>
      {state.status === 'error' && <p role="alert" className="mt-3 text-[14px] text-[var(--critical-text)]">{state.message}</p>}
    </form>
  );
}
