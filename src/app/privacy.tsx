/**
 * Plain-language privacy page. Every statement here should match what the
 * code actually does; update it whenever a network call or stored field changes.
 */
import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { resolveConfig } from '@/data/config';
import { AppText, Card, Screen, ScreenHeader, TopBar } from '@/ui/components/primitives';
import { colors, spacing } from '@/ui/theme';

const config = resolveConfig();

export default function Privacy() {
  const router = useRouter();
  return (
    <Screen>
      <TopBar onBack={() => router.back()} />
      <ScreenHeader title="Privacy" subtitle="What Huddle keeps, and what leaves your phone." />

      <Item title="Do I need an account?">
        No. Huddle has no sign-up and no login, and nothing ties your use of the app to you.
      </Item>

      <Item title="What’s stored on this phone">
        Your preferences (location, distance, budget, interests), the adventure you’ve planned, ideas you’ve saved
        or passed on, completed adventures, your emoji reactions and your private reflections. They live in a local
        database on this phone and are never uploaded.
      </Item>

      <Item title="What’s sent to other services">
        {[
          config.supabase
            ? 'The app downloads public activity listings from Huddle’s online catalog (Supabase). It doesn’t send your preferences or history there.'
            : 'This build doesn’t talk to an online catalog; the activities ship inside the app.',
          'If you tap “Use my location” or type a place after allowing location, your phone’s built-in location service (Apple on iPhone) turns it into coordinates or a place name.',
          'Links you open (directions, Instagram posts, organizer pages) open in Maps or your browser, which follow their own privacy policies.',
        ].join('\n\n')}
      </Item>

      <Item title="Where recommendations come from">
        Huddle picks from a catalog of public listings: San Francisco events gathered from public Instagram posts and
        well-known places, or activities you import. Suggestions are chosen on your phone using your moods, filters and
        what you’ve passed on before. Listings are marked unverified unless someone has checked them with the
        organizer.
      </Item>

      <Item title="Exporting and deleting">
        Settings › Export my history creates a JSON file of your planned and completed adventures, reactions and
        reflections, and you choose where to share it. Settings › Delete local history permanently removes that history
        from this phone; your preferences stay.
      </Item>

      <Item title="Analytics and tracking">None. Huddle has no analytics, no ads and no tracking.</Item>
    </Screen>
  );
}

function Item({ title, children }: { title: string; children: string }) {
  return (
    <Card>
      <View style={styles.item}>
        <AppText variant="bodyStrong" accessibilityRole="header">
          {title}
        </AppText>
        <AppText variant="body" color={colors.inkSoft}>
          {children}
        </AppText>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  item: { gap: spacing.sm },
});
