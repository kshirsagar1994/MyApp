import { Tabs } from 'expo-router';
import React from 'react';
import { Ionicons } from '@expo/vector-icons';


import { useColorScheme } from '@/hooks/use-color-scheme';

export default function TabLayout() {
  const colorScheme = useColorScheme();
  const themeTextColor = colorScheme === 'dark' ? '#fff' : '#000';

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: '#00E5FF', // Neon cyan to match index.tsx themes
        tabBarInactiveTintColor: colorScheme === 'dark' ? '#8FA1B3' : 'gray',
        headerShown: true,
        headerStyle: {
          backgroundColor: colorScheme === 'dark' ? '#000B18' : '#ffffff',
        },
        headerTintColor: themeTextColor,
        tabBarStyle: {
          backgroundColor: colorScheme === 'dark' ? '#02050D' : '#ffffff',
          borderTopWidth: colorScheme === 'dark' ? 1 : 0,
          borderTopColor: colorScheme === 'dark' ? 'rgba(255, 255, 255, 0.1)' : 'transparent',
          elevation: 5,
        },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color }) => <Ionicons size={28} name="home" color={color} />,
        }}
      />
      <Tabs.Screen
        name="downloads"
        options={{
          title: 'Downloads',
          tabBarIcon: ({ color }) => <Ionicons size={28} name="download" color={color} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color }) => <Ionicons size={28} name="settings" color={color} />,
        }}
      />
    </Tabs>
  );
}
