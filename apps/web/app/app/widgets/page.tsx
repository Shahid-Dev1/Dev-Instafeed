'use client';

import { WidgetList } from '../../../components/widgets/WidgetList';

export default function EmbeddedWidgets() {
  return (
    <main>
      <h1>Widgets</h1>
      <WidgetList hrefFor={(id) => `/app/widgets/${id}`} />
    </main>
  );
}
