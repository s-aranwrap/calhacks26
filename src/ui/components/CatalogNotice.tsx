/**
 * Tells the user, briefly and honestly, where the activities come from:
 * sample data, a cached copy while offline, or live data.
 */
import { formatCheckedAgo } from '@/core/time';
import { DEMO_TOWN } from '@/data/fixtures/demoActivities';
import { useApp } from '@/state/AppProvider';

import { Notice } from './feedback';

export function CatalogNotice() {
  const { catalog } = useApp();
  if (!catalog) return null;

  if (catalog.remoteStatus === 'cached') {
    const ago = formatCheckedAgo(catalog.cachedAt, new Date())?.replace('Checked', 'saved');
    return (
      <Notice tone="offline">{`You seem to be offline. Showing the copy of the catalog ${ago ?? 'saved earlier'}.`}</Notice>
    );
  }
  if (catalog.remoteStatus === 'unavailable' && !catalog.usesDemo) {
    return <Notice tone="offline">Couldn’t reach the online catalog. Showing the activities you imported.</Notice>;
  }
  if (catalog.usesDemo) {
    return (
      <Notice tone="info" icon="flask-outline">
        {catalog.remoteStatus === 'unavailable'
          ? `Couldn’t reach the activity catalog, so you’re seeing sample activities in ${DEMO_TOWN}, a made-up town.`
          : `You’re seeing sample activities in ${DEMO_TOWN}, a made-up town, so you can try Huddle. Import your own list in Settings for real places.`}
      </Notice>
    );
  }
  return null;
}
