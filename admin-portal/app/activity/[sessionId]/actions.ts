'use server';

import { BackendError, callBackend } from '@/lib/backend';

export interface SubmitState {
  status: 'idle' | 'saved' | 'error';
  message?: string;
}

/** Saves the activity text; the backend validates length and allows one answer per session. */
export async function submitActivity(_previous: SubmitState, form: FormData): Promise<SubmitState> {
  const sessionId = String(form.get('sessionId') ?? '');
  const text = String(form.get('text') ?? '');
  try {
    await callBackend('activity_submit', { session_id: sessionId, text });
    return { status: 'saved' };
  } catch (error) {
    const message = error instanceof BackendError && error.code === 'validation_error'
      ? error.message
      : 'Something went wrong. Please try again.';
    return { status: 'error', message };
  }
}
