import Link from 'next/link';
import { MeSummary } from '../../components/MeSummary';
import { TeamManager } from '../../components/TeamManager';

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const { view } = await searchParams;
  return (
    <main>
      <h1>Instafeed dashboard</h1>
      <MeSummary teamHref="/dashboard?view=team" />
      {view === 'team' && (
        <>
          <h2>Team</h2>
          <TeamManager />
          <p><Link href="/dashboard">Back</Link></p>
        </>
      )}
    </main>
  );
}
