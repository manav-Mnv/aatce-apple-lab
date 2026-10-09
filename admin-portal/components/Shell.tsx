'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useLab } from './LabProvider';
import { Icon, type IconName } from './Icon';

const NAV: { href: string; label: string; icon: IconName }[] = [
  { href: '/', label: 'Overview', icon: 'overview' },
  { href: '/sessions', label: 'Sessions', icon: 'sessions' },
  { href: '/students', label: 'Students', icon: 'students' },
  { href: '/analytics', label: 'Analytics', icon: 'analytics' }
];

export function Shell({ children }: { children: React.ReactNode }) {
  const lab = useLab();

  if (!lab.mounted || lab.auth.status === 'loading') return <Splash />;
  if (lab.auth.status === 'signedOut') return <SignIn />;

  return (
    <div className="min-h-screen md:flex">
      <Sidebar />
      <main className="min-w-0 flex-1 px-4 pb-16 pt-6 sm:px-8 md:px-12 md:pt-12">
        {!lab.authEnabled && (
          <p className="mb-6 rounded-xl bg-[var(--warning-bg)] px-4 py-2.5 text-[13px] text-[var(--warning-text)]">
            Development mode — Firebase sign-in is not configured, so the portal is open on this machine only.
          </p>
        )}
        {lab.error && (
          <p role="alert" className="mb-6 rounded-xl bg-[var(--critical-bg)] px-4 py-2.5 text-[13px] text-[var(--critical-text)]">
            {lab.error}
          </p>
        )}
        {children}
      </main>
    </div>
  );
}

function Sidebar() {
  const pathname = usePathname();
  const lab = useLab();
  const user = lab.auth.status === 'signedIn' ? lab.auth.user : null;

  return (
    <aside className="sticky top-0 z-10 border-b border-[var(--separator)] bg-[var(--sidebar)] backdrop-blur-xl md:h-screen md:w-64 md:shrink-0 md:border-b-0 md:border-r">
      <div className="flex items-center gap-3 px-4 py-3 sm:px-6 md:px-5 md:pb-6 md:pt-8">
        <div className="grid h-9 w-9 place-items-center rounded-[10px] bg-[var(--accent)] text-white">
          <Icon name="lab" className="h-5 w-5" />
        </div>
        <div className="leading-tight">
          <div className="text-[15px] font-semibold">Apple Lab</div>
          <div className="text-[12px] text-[var(--text-secondary)]">AATCE Admin</div>
        </div>
      </div>
      <nav className="flex gap-1 overflow-x-auto px-3 pb-3 [scrollbar-width:none] md:flex-col md:px-3">
        {NAV.map((item) => {
          const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={`flex shrink-0 items-center gap-3 rounded-lg px-3 py-2 text-[14px] transition-colors ${
                active ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-primary)] hover:bg-[var(--fill)]'
              }`}
            >
              <Icon name={item.icon} className="h-[18px] w-[18px]" />
              {item.label}
            </Link>
          );
        })}
      </nav>
      {(user || lab.authEnabled) && (
        <div className="hidden px-5 md:absolute md:bottom-6 md:block md:w-64">
          <div className="truncate text-[12px] text-[var(--text-secondary)]">{user?.email}</div>
          <button onClick={lab.signOut} className="mt-1 text-[13px] text-[var(--accent)] hover:underline">
            Sign out
          </button>
        </div>
      )}
    </aside>
  );
}

function Splash() {
  return <div className="grid min-h-screen place-items-center text-[var(--text-secondary)]">Loading…</div>;
}

function SignIn() {
  const lab = useLab();
  return (
    <div className="grid min-h-screen place-items-center px-4">
      <div className="w-full max-w-sm text-center">
        <div className="mx-auto mb-6 grid h-16 w-16 place-items-center rounded-[18px] bg-[var(--accent)] text-white">
          <Icon name="lab" className="h-8 w-8" />
        </div>
        <h1 className="text-[32px] font-semibold tracking-tight">Apple Lab</h1>
        <p className="mt-2 text-[17px] text-[var(--text-secondary)]">Sign in with your university Google account to view lab attendance.</p>
        <button
          onClick={lab.signIn}
          className="mt-8 w-full rounded-full bg-[var(--accent)] px-6 py-3 text-[17px] text-white transition hover:brightness-110"
        >
          Sign in with Google
        </button>
        {lab.error && <p role="alert" className="mt-4 text-[13px] text-[var(--critical-text)]">{lab.error}</p>}
      </div>
    </div>
  );
}
