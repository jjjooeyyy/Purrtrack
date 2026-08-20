import { Ionicons } from "@expo/vector-icons";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { NavigatorScreenParams } from "@react-navigation/native";
import { createStackNavigator } from "@react-navigation/stack";
import React from "react";
import { View } from "react-native";

import DayDetailScreen from "../screens/DayDetailScreen";
import FoodManagementScreen from "../screens/FoodManagementScreen";
import HistoryScreen from "../screens/HistoryScreen";
import HomeScreen from "../screens/HomeScreen";
import LogScreen from "../screens/LogScreen";
import MeScreen from "../screens/MeScreen";
import ScheduleScreen from "../screens/Schedule";
import WeightTrackerScreen from "../screens/WeightTrackerScreen";

const APP_BACKGROUND = "#F7F4EB";

export type TabParamList = {
  Home: undefined;
  Log: NavigatorScreenParams<LogStackParamList> | undefined;
  HistoryTab: NavigatorScreenParams<HistoryStackParamList> | undefined;
  Schedule: undefined;
  Me: undefined;
};

export type LogTab = "meal" | "water" | "litter" | "care" | "journal";

export type LogStackParamList = {
  LogMain:
    | { initialTab?: LogTab; openFoodCatalogManager?: boolean }
    | undefined;
  FoodManagement: undefined;
  WeightTracker: undefined;
};

export type HistoryStackParamList = {
  History: undefined;
  DayDetail: { date: string };
};

const Tab = createBottomTabNavigator<TabParamList>();
const LogStack = createStackNavigator<LogStackParamList>();
const HistoryStack = createStackNavigator<HistoryStackParamList>();

function LogNavigator() {
  return (
    <LogStack.Navigator
      screenOptions={{
        headerShown: false,
      }}
    >
      <LogStack.Screen
        name="LogMain"
        component={LogScreen}
        options={{ title: "新增紀錄" }}
      />
      <LogStack.Screen
        name="FoodManagement"
        component={FoodManagementScreen}
        options={{ title: "食物管理" }}
      />
      <LogStack.Screen
        name="WeightTracker"
        component={WeightTrackerScreen}
        options={{ title: "體重紀錄" }}
      />
    </LogStack.Navigator>
  );
}

function HistoryNavigator() {
  return (
    <HistoryStack.Navigator
      screenOptions={({}) => ({
        headerShown: false,
      })}
    >
      <HistoryStack.Screen
        name="History"
        component={HistoryScreen}
        options={{ title: "歷史紀錄" }}
      />
      <HistoryStack.Screen
        name="DayDetail"
        component={DayDetailScreen}
        options={{ title: "當日詳情" }}
      />
    </HistoryStack.Navigator>
  );
}

export default function MainTabNavigator() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        lazy: true,
        sceneStyle: { backgroundColor: APP_BACKGROUND },
        tabBarActiveTintColor: "#7FA655",
        tabBarInactiveTintColor: "#F8F1E9",
        tabBarStyle: {
          position: "absolute",
          left: 15,
          right: 15,
          bottom: 20,
          borderRadius: 20,
          backgroundColor: APP_BACKGROUND,
          height: 70,
          elevation: 0,
          shadowOpacity: 0,
          paddingHorizontal: 25,
        },
        headerShown: false,
        tabBarLabelStyle: { fontFamily: "ZenMaruGothic-Bold", fontSize: 13 },
        tabBarItemStyle: { paddingTop: 7 },
        tabBarBackground: () => (
          <View
            style={{
              flex: 1,
              backgroundColor: "black",
              borderRadius: 20,
              marginHorizontal: 20,
            }}
          />
        ),
        tabBarIcon: ({ color, size }) => {
          let iconName: React.ComponentProps<typeof Ionicons>["name"] =
            "home-outline";
          let iconSize = size;
          if (route.name === "Home") {
            iconName = "home-outline";
            iconSize = size - 5;
          } else if (route.name === "Log") {
            iconName = "add-circle-outline";
            iconSize = size - 5;
          } else if (route.name === "HistoryTab") {
            iconName = "calendar-outline";
            iconSize = size - 5;
          } else if (route.name === "Me") {
            iconName = "person-outline";
            iconSize = size - 5;
          } else if (route.name === "Schedule") {
            iconName = "time-outline";
            iconSize = size - 5;
          }
          return <Ionicons name={iconName} size={iconSize} color={color} />;
        },
      })}
    >
      <Tab.Screen
        name="Home"
        component={HomeScreen}
        options={{
          title: "首頁",
          tabBarLabel: "首頁",
          headerTitleStyle: { fontFamily: "ZenMaruGothic-Bold", fontSize: 18 },
        }}
      />
      <Tab.Screen
        name="Log"
        component={LogNavigator}
        options={{
          title: "新增",
          tabBarLabel: "新增",
          headerTitleStyle: { fontFamily: "ZenMaruGothic-Bold", fontSize: 18 },
        }}
        listeners={({ navigation }) => ({
          tabPress: (event) => {
            event.preventDefault();
            navigation.navigate("Log", {
              screen: "LogMain",
            });
          },
        })}
      />
      <Tab.Screen
        name="HistoryTab"
        component={HistoryNavigator}
        options={{
          title: "歷史",
          tabBarLabel: "歷史",
          headerTitleStyle: { fontFamily: "ZenMaruGothic-Bold", fontSize: 18 },
        }}
      />
      <Tab.Screen
        name="Schedule"
        component={ScheduleScreen}
        options={{
          title: "餵食時間",
          tabBarLabel: "餵食時間",
          headerTitleStyle: { fontFamily: "ZenMaruGothic-Bold", fontSize: 18 },
        }}
      />
      <Tab.Screen
        name="Me"
        component={MeScreen}
        options={{
          title: "設定",
          tabBarLabel: "設定",
          headerTitleStyle: { fontFamily: "ZenMaruGothic-Bold", fontSize: 18 },
        }}
      />
    </Tab.Navigator>
  );
}
