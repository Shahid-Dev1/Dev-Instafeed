import { WidgetEditor } from '../../../../components/widgets/WidgetEditor';

export default async function EmbeddedWidgetEditor({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <main>
      <WidgetEditor id={id} backHref="/app/widgets" />
    </main>
  );
}
