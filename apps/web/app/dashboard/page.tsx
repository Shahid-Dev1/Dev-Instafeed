import Link from 'next/link';
import { AnalyticsDashboard } from '../../components/analytics/AnalyticsDashboard';
import { MeSummary } from '../../components/MeSummary';
import { ProductsBrowser } from '../../components/ProductsBrowser';
import { VideoLibrary } from '../../components/videos/VideoLibrary';
import { WidgetEditor } from '../../components/widgets/WidgetEditor';
import { WidgetListClient } from '../../components/widgets/WidgetListClient';
import { TeamManager } from '../../components/TeamManager';

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ view?: string; id?: string }> }) {
  const { view, id } = await searchParams;
  return (
    <main>
      <h1>Instafeed dashboard</h1>
      <MeSummary teamHref="/dashboard?view=team" productsHref="/dashboard?view=products" videosHref="/dashboard?view=videos" widgetsHref="/dashboard?view=widgets" analyticsHref="/dashboard?view=analytics" />
      {view === 'analytics' && <AnalyticsDashboard />}
      {view === 'widgets' && <WidgetListLinks />}
      {view === 'widget' && id && <WidgetEditor id={id} backHref="/dashboard?view=widgets" />}
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

function WidgetListLinks() {
  return (
    <>
      <h2>Widgets</h2>
      <WidgetListClient />
    </>
  );
}
