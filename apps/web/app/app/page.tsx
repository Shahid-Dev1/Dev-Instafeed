import { MeSummary } from '../../components/MeSummary';

export default function EmbeddedHome() {
  return (
    <main>
      <h1>Instafeed</h1>
      <MeSummary teamHref="/app/team" productsHref="/app/products" videosHref="/app/videos" widgetsHref="/app/widgets" analyticsHref="/app/analytics" integrationsHref="/app/integrations" settingsHref="/app/settings" />
    </main>
  );
}
