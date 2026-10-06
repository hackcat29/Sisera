import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { NavigationContainer } from "@react-navigation/native";
import {
  BarChart3,
  Bot,
  Compass,
  Cpu,
  Layers,
  TrendingUp,
} from "lucide-react-native";
import React from "react";
import { StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { THEME } from "../constants/theme";
import { AgentsScreen } from "../screens/AgentsScreen";
import { HubScreen } from "../screens/HubScreen";
import { IntelligenceScreen } from "../screens/IntelligenceScreen";
import { MarketsScreen } from "../screens/MarketsScreen";
import { PortfolioScreen } from "../screens/PortfolioScreen";
import { TerminalScreen } from "../screens/TerminalScreen";

const Tab = createBottomTabNavigator();

export const RootNavigator: React.FC = () => {
  const insets = useSafeAreaInsets();

  return (
    <NavigationContainer>
      <Tab.Navigator
        screenOptions={{
          headerShown: false,
          tabBarStyle: [
            styles.tabBar,
            {
              height: 54 + Math.max(insets.bottom, 8),
              paddingBottom: Math.max(insets.bottom, 6),
            },
          ],
          tabBarActiveTintColor: THEME.colors.bronze,
          tabBarInactiveTintColor: THEME.colors.textFaint,
          tabBarLabelStyle: styles.tabLabel,
        }}
      >
        <Tab.Screen
          name="Intelligence"
          component={IntelligenceScreen}
          options={{
            tabBarLabel: "Sisera AI",
            tabBarIcon: ({ color, size }) => (
              <Bot color={color} size={size - 2} />
            ),
          }}
        />

        <Tab.Screen
          name="Markets"
          component={MarketsScreen}
          options={{
            tabBarLabel: "Markets",
            tabBarIcon: ({ color, size }) => (
              <TrendingUp color={color} size={size - 2} />
            ),
          }}
        />

        <Tab.Screen
          name="Terminal"
          component={TerminalScreen}
          options={{
            tabBarLabel: "Terminal",
            tabBarIcon: ({ color, size }) => (
              <BarChart3 color={color} size={size - 2} />
            ),
          }}
        />

        <Tab.Screen
          name="Agents"
          component={AgentsScreen}
          options={{
            tabBarLabel: "Agents",
            tabBarIcon: ({ color, size }) => (
              <Cpu color={color} size={size - 2} />
            ),
          }}
        />

        <Tab.Screen
          name="Portfolio"
          component={PortfolioScreen}
          options={{
            tabBarLabel: "Portfolio",
            tabBarIcon: ({ color, size }) => (
              <Layers color={color} size={size - 2} />
            ),
          }}
        />

        <Tab.Screen
          name="Hub"
          component={HubScreen}
          options={{
            tabBarLabel: "Hub",
            tabBarIcon: ({ color, size }) => (
              <Compass color={color} size={size - 2} />
            ),
          }}
        />
      </Tab.Navigator>
    </NavigationContainer>
  );
};

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: THEME.colors.surface,
    borderTopWidth: 1,
    borderTopColor: THEME.colors.line,
    height: 62,
    paddingBottom: 8,
    paddingTop: 6,
  },
  tabLabel: {
    fontSize: 9,
    fontFamily: THEME.fonts.mono,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
});
