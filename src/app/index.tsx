/** Entry gate: first-time users see the welcome screen, everyone else goes to Discover. */
import { Redirect } from 'expo-router';

import { useApp } from '@/state/AppProvider';
import { LoadingState } from '@/ui/components/feedback';
import { Screen } from '@/ui/components/primitives';

export default function Index() {
  const { ready, preferences } = useApp();
  if (!ready) {
    return (
      <Screen scroll={false} contentStyle={{ justifyContent: 'center' }}>
        <LoadingState />
      </Screen>
    );
  }
  return <Redirect href={preferences.onboardedAt ? '/discover' : '/welcome'} />;
}
