import type { Metadata } from 'next';
import { ActivityForm } from '@/components/ActivityForm';
import { callBackend } from '@/lib/backend';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Apple Lab — What did you work on?', robots: { index: false } };

interface ActivitySession {
  state: 'form' | 'done' | 'invalid';
  name?: string;
  entry_time?: string;
  duration_mins?: number | '';
}

/**
 * Public page linked from the activity email (FR-15). No sign-in: the random
 * session UUID in the link is the credential for that one session. The backend
 * is called server-side with the admin secret, which never reaches the browser.
 */
export default async function ActivityPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  let session: ActivitySession;
  try {
    session = await callBackend<ActivitySession>('activity_get', { session_id: sessionId });
  } catch {
    return <Panel title="Something went wrong." detail="The lab system is unavailable. Please try the link again later." />;
  }

  if (session.state === 'invalid') {
    return <Panel title="Link not valid." detail="This activity link has expired or doesn't exist." />;
  }
  if (session.state === 'done') {
    return <Panel done title="Already logged." detail="You've already told us what you worked on in this session." />;
  }

  const date = session.entry_time
    ? new Date(session.entry_time).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Kolkata' })
    : '';
  const firstName = session.name?.split(' ')[0];

  return (
    <Frame>
      <p className="mb-2 text-[13px] text-[var(--text-secondary)]">AATCE Apple Lab</p>
      <h1 className="text-[32px] font-semibold leading-tight tracking-tight">
        {firstName ? `${firstName}, what did you work on?` : 'What did you work on?'}
      </h1>
      <p className="mb-7 mt-2 text-[17px] text-[var(--text-secondary)]">
        {date}{session.duration_mins !== '' && session.duration_mins !== undefined ? ` · ${session.duration_mins} min` : ''}
      </p>
      <ActivityForm sessionId={sessionId} />
    </Frame>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <main className="grid min-h-screen place-items-center px-4 py-6">
      <div className="w-full max-w-[520px] rounded-[18px] bg-[var(--card)] px-8 py-10 shadow-[var(--card-shadow)]">{children}</div>
    </main>
  );
}

function Panel({ title, detail, done = false }: { title: string; detail: string; done?: boolean }) {
  return (
    <Frame>
      <div className="text-center">
        {done && <Check />}
        <h1 className="text-[32px] font-semibold tracking-tight">{title}</h1>
        <p className="mt-2 text-[17px] text-[var(--text-secondary)]">{detail}</p>
      </div>
    </Frame>
  );
}

function Check() {
  return (
    <svg viewBox="0 0 56 56" className="mx-auto mb-5 h-14 w-14" aria-hidden="true">
      <circle cx="28" cy="28" r="28" fill="#34c759" />
      <path d="M17 29l7 7 15-16" stroke="#fff" strokeWidth="4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
