import { LabProvider } from '@/components/LabProvider';
import { Shell } from '@/components/Shell';

/** Admin pages: Google sign-in, data loading and the sidebar. */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <LabProvider>
      <Shell>{children}</Shell>
    </LabProvider>
  );
}
