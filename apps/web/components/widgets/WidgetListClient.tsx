'use client';

import { WidgetList } from './WidgetList';

/** Standalone dashboard variant: editor lives at /dashboard?view=widget&id=… */
export function WidgetListClient() {
  return <WidgetList hrefFor={(id) => `/dashboard?view=widget&id=${encodeURIComponent(id)}`} />;
}
