import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { NavigationContainer } from "@react-navigation/native";
import {
  Activity,
  Bot,
  Cpu,
  Layers,
  Settings as SettingsIcon,
  TrendingUp,
} from "lucide-react-native";
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { THEME } from "../constants/theme";
import { AgentsScreen } from "../screens/AgentsScreen";
import { ClawpumpScreen } from "../screens/ClawpumpScreen";
import { IntelligenceScreen } from "../screens/IntelligenceScreen";
import { MarketsScreen } from "../screens/MarketsScreen";
import { PortfolioScreen } from "../screens/PortfolioScreen";
import { SettingsScreen } from "../screens/SettingsScreen";

const Tab = createBottomTabNavigator();

export const RootNavigator: React.FC = () => {
  return (
    <NavigationContainer>
      <Tab.Navigator
        screenOptions={{
          headerShown: false,
          tabBarStyle: styles.tabBar,
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
          name="Clawpump"
          component={ClawpumpScreen}
          options={{
            tabBarLabel: "Clawpump",
            tabBarIcon: ({ color, size }) => (
              <Activity color={color} size={size - 2} />
            ),
          }}
        />

        <Tab.Screen
          name="Settings"
          component={SettingsScreen}
          options={{
            tabBarLabel: "Config",
            tabBarIcon: ({ color, size }) => (
              <SettingsIcon color={color} size={size - 2} />
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
    height: 60,
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
