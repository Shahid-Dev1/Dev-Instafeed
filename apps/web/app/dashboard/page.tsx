import Link from 'next/link';
import { MeSummary } from '../../components/MeSummary';
import { ProductsBrowser } from '../../components/ProductsBrowser';
import { VideoLibrary } from '../../components/videos/VideoLibrary';
import { TeamManager } from '../../components/TeamManager';

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const { view } = await searchParams;
  return (
    <main>
      <h1>Instafeed dashboard</h1>
      <MeSummary teamHref="/dashboard?view=team" productsHref="/dashboard?view=products" videosHref="/dashboard?view=videos" />
      {view === 'videos' && (
        <>
          <h2>Videos</h2>
          <VideoLibrary />
          <p><Link href="/dashboard">Back</Link></p>
        </>
      )}
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
