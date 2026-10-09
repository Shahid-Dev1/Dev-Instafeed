import Link from 'next/link';
import { MeSummary } from '../../components/MeSummary';
import { ProductsBrowser } from '../../components/ProductsBrowser';
import { TeamManager } from '../../components/TeamManager';

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const { view } = await searchParams;
  return (
    <main>
      <h1>Instafeed dashboard</h1>
      <MeSummary teamHref="/dashboard?view=team" productsHref="/dashboard?view=products" />
      {view === 'products' && (
        <>
          <h2>Products</h2>
          <ProductsBrowser />
          <p><Link href="/dashboard">Back</Link></p>
        </>
      )}
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
