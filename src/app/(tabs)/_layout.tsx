import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router';

import { colors, fonts } from '@/ui/theme';

// Icons use the same tints as the labels (the navigator's color type is wider than Ionicons accepts).
const tabTint = (focused: boolean) => (focused ? colors.skyInk : colors.inkMuted);

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.skyInk,
        tabBarInactiveTintColor: colors.inkMuted,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
        tabBarLabelStyle: { fontFamily: fonts.bold, fontSize: 12 },
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      <Tabs.Screen
        name="discover"
        options={{
          title: 'Discover',
          tabBarIcon: ({ size, focused }) => (
            <Ionicons name={focused ? 'compass' : 'compass-outline'} size={size} color={tabTint(focused)} />
          ),
        }}
      />
      <Tabs.Screen
        name="adventures"
        options={{
          title: 'My adventures',
          tabBarIcon: ({ size, focused }) => (
            <Ionicons name={focused ? 'map' : 'map-outline'} size={size} color={tabTint(focused)} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ size, focused }) => (
            <Ionicons name={focused ? 'settings' : 'settings-outline'} size={size} color={tabTint(focused)} />
          ),
        }}
      />
    </Tabs>
  );
}
