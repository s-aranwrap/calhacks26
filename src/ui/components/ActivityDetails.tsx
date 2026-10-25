/**
 * The facts block of an activity: identity, When / Where / Cost / What to
 * know, and the source with its verification status. Estimated and unknown
 * values are labelled; nothing unknown is shown as a default.
 */
import { useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { assessAvailability } from '@/core/availability';
import { assessChallenge, CHALLENGE_LABEL } from '@/core/challenge';
import { formatDuration, formatPrice } from '@/core/format';
import { formatWeeklyHours, parsedHours } from '@/core/hours';
import { formatCheckedAgo, isValidTimeZone } from '@/core/time';
import type { Activity } from '@/core/types';
import { distanceKm, formatDistance } from '@/core/util';
import { useApp } from '@/state/AppProvider';

import { CATEGORY_ICON, CATEGORY_LABEL, whenText } from '../activityMeta';
import { directionsUrl, sourceHost } from '../links';
import { colors, spacing } from '../theme';
import { ChallengeBadge, FactRow, Notice, TrustBadge } from './feedback';
import { AppText, Button, Card, Icon, LinkButton, Row, Section } from './primitives';

/** Identity, practical facts and source. Shared with the adventure view's "View details". */
export function DetailsBody({
  activity,
  now,
  distance: knownDistance,
  onOpen,
}: {
  activity: Activity;
  now: Date;
  distance?: number | undefined;
  onOpen: (url: string) => void;
}) {
  const app = useApp();
  const availability = assessAvailability(activity, now);
  const challenge = assessChallenge(activity);
  const price = formatPrice(activity.price);
  const duration = formatDuration(activity.duration);
  const when = whenText(activity, now);
  const weekly = activity.kind === 'evergreen' ? parsedHours(activity.openingHours) : null;
  const distance =
    knownDistance ??
    (app.origin && activity.venue?.latitude !== undefined && activity.venue.longitude !== undefined
      ? distanceKm(app.origin, { latitude: activity.venue.latitude, longitude: activity.venue.longitude })
      : undefined);
  const deviceZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const showZone = activity.kind === 'event' && isValidTimeZone(activity.timeZone) && activity.timeZone !== deviceZone;
  const directions = directionsUrl(activity);
  const isDemo = activity.verification.status === 'demo';
  const checked = formatCheckedAgo(activity.verification.lastCheckedAt, now);
  const freeVerified = activity.price?.minAmount === 0 && activity.price.certainty === 'verified';

  return (
    <>
      <View style={styles.titleBlock}>
        <Row gap={spacing.sm} wrap>
          <Icon name={CATEGORY_ICON[activity.category]} size={16} color={colors.primaryInk} />
          <AppText variant="caption" color={colors.primaryInk}>
            {CATEGORY_LABEL[activity.category]} · {activity.kind === 'event' ? 'Event' : 'Any time'}
          </AppText>
        </Row>
        <AppText variant="title" accessibilityRole="header">
          {activity.title}
        </AppText>
        <Row gap={spacing.sm} wrap>
          <ChallengeBadge challenge={challenge} />
          <TrustBadge activity={activity} />
        </Row>
        {activity.description ? <Description text={activity.description} /> : null}
      </View>

      {!availability.viable ? (
        <Notice tone="warning">{`${availability.label}. It can’t be planned right now.`}</Notice>
      ) : isDemo ? (
        <Notice tone="info" icon="flask-outline">
          This is a made-up sample listing for trying the app. Nothing here is a real event, venue or price.
        </Notice>
      ) : null}

      <Card>
        <InfoGroup title="When">
          <FactRow
            icon={when.icon}
            text={when.text}
            certainty={when.known ? undefined : 'unknown'}
            detail={
              [
                showZone ? `Times shown in ${activity.timeZone}` : undefined,
                weekly ? formatWeeklyHours(weekly) : undefined,
                activity.openingHoursSource ? `Hours from ${activity.openingHoursSource}` : undefined,
              ]
                .filter(Boolean)
                .join('. ') || undefined
            }
          />
          <FactRow icon="hourglass-outline" text={duration.text} certainty={duration.certainty} />
        </InfoGroup>
        <InfoGroup title="Where">
          <FactRow
            icon="location-outline"
            text={activity.venue?.name ?? 'Location not listed'}
            certainty={activity.venue ? undefined : 'unknown'}
            detail={
              [
                activity.venue?.address,
                activity.venue?.area && activity.venue.area !== activity.venue.name ? activity.venue.area : undefined,
                distance !== undefined
                  ? `${formatDistance(distance)} away${isDemo ? ' (in the sample town)' : ''}`
                  : activity.venue
                    ? 'Distance unknown'
                    : undefined,
              ]
                .filter(Boolean)
                .join(' · ') || undefined
            }
          />
          {directions ? (
            <Button
              label="Get directions"
              variant="soft"
              icon="navigate-outline"
              compact
              onPress={() => onOpen(directions)}
            />
          ) : activity.venue && !isDemo ? (
            <AppText variant="caption">No exact address listed, so there are no directions yet.</AppText>
          ) : null}
        </InfoGroup>
        <InfoGroup title="Cost">
          <FactRow
            icon="wallet-outline"
            text={freeVerified ? 'Free entry (confirmed by the source)' : price.text}
            certainty={price.certainty}
            detail={activity.price?.note}
          />
        </InfoGroup>
        {activity.restrictions || activity.whatToExpect ? (
          <InfoGroup title="What to know">
            {activity.restrictions ? <FactRow icon="information-circle-outline" text={activity.restrictions} /> : null}
            {activity.whatToExpect ? <AppText variant="small">{activity.whatToExpect}</AppText> : null}
          </InfoGroup>
        ) : null}
      </Card>

      {activity.whyTry ? (
        <Section title="Why it might be worth it">
          <AppText variant="body">{activity.whyTry}</AppText>
        </Section>
      ) : null}

      <Section title="Source">
        <Card tone="sky">
          <FactRow
            icon={activity.verification.status === 'verified' ? 'shield-checkmark-outline' : 'help-circle-outline'}
            text={
              isDemo
                ? 'Huddle sample data (fictional)'
                : (activity.source.label ?? sourceHost(activity.source.url) ?? 'Source not named')
            }
            detail={
              activity.verification.status === 'verified'
                ? `Event details verified with the organizer${checked ? ` · ${checked.toLowerCase()}` : ''}`
                : isDemo
                  ? 'Not a real listing'
                  : `Not verified by Huddle. ${availability.label}.`
            }
          />
          {activity.kind === 'evergreen' && !isDemo ? (
            <AppText variant="caption" color={colors.skyInk}>
              Opening hours may change.
            </AppText>
          ) : null}
          {activity.source.url && !isDemo ? (
            <LinkButton
              label={activity.source.platform === 'instagram' ? 'Open the original Instagram post' : 'Open the source page'}
              icon="open-outline"
              color={colors.skyInk}
              onPress={() => onOpen(activity.source.url!)}
            />
          ) : null}
        </Card>
        <AppText variant="caption">
          {`Challenge: ${CHALLENGE_LABEL[challenge.level]}.${challenge.notes.length ? ` ${challenge.notes.join(' · ')}` : ''}`}
        </AppText>
      </Section>
    </>
  );
}

/** Long source captions (Instagram posts) collapse to a few lines. */
function Description({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 240 || text.split('\n').length > 5;
  return (
    <View>
      <AppText variant="body" numberOfLines={long && !open ? 5 : undefined}>
        {text}
      </AppText>
      {long ? <LinkButton label={open ? 'Show less' : 'Read more'} onPress={() => setOpen((o) => !o)} /> : null}
    </View>
  );
}

function InfoGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.group}>
      <AppText variant="caption" color={colors.inkSoft} accessibilityRole="header">
        {title.toUpperCase()}
      </AppText>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  titleBlock: { gap: spacing.sm },
  group: { gap: spacing.sm },
});
