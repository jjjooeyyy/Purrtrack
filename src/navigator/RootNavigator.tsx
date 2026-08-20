import { NavigatorScreenParams, useNavigation } from "@react-navigation/native";
import { createStackNavigator } from "@react-navigation/stack";
import React, { useEffect } from "react";
import { ActivityIndicator, Linking, View } from "react-native";
import { usePetSession } from "../hooks/usePetSession";
import AddCatProfileScreen from "../screens/AddCatProfileScreen";
import FoodManagementScreen from "../screens/FoodManagementScreen";
import LoginScreen from "../screens/LoginScreen";
import MainTabNavigator, { TabParamList } from "./MainTabNavigator";

export type RootStackParamList = {
  Login: undefined;
  AddCatProfile:
    | {
        editMode?: boolean;
        joinMode?: boolean;
        petId?: string;
        source?: "me";
      }
    | undefined;
  FoodManagement: undefined;
  MainTabs: NavigatorScreenParams<TabParamList> | undefined;
};

const Stack = createStackNavigator<RootStackParamList>();

export default function RootNavigator() {
  const { user, pets, loading } = usePetSession();
  const navigation = useNavigation<any>();
  const hasMemberships = pets.length > 0;

  useEffect(() => {
    const handleUrl = (url: string) => {
      console.log("Incoming URL:", url);
      if (url === "purrtrack://schedule") {
        navigation.navigate("MainTabs", {
          screen: "Schedule",
        });
        return;
      }

      if (url.startsWith("purrtrack://log/")) {
        const action = url.replace("purrtrack://log/", "");
        let initialTab: any = "meal";
        if (action === "water") initialTab = "water";
        if (action === "wee" || action === "litter") initialTab = "litter";

        console.log("Navigating to Log with tab:", initialTab);

        navigation.navigate("MainTabs", {
          screen: "Log",
          params: {
            screen: "LogMain",
            params: { initialTab },
          },
        });
      }
    };

    Linking.getInitialURL().then((url) => {
      if (url) handleUrl(url);
    });

    const subscription = Linking.addEventListener("url", (event) => {
      handleUrl(event.url);
    });

    return () => {
      subscription.remove();
    };
  }, [navigation]);

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator size="large" color="#7FA655" />
      </View>
    );
  }

  return (
    <Stack.Navigator
      initialRouteName={hasMemberships ? "MainTabs" : "AddCatProfile"}
      screenOptions={{ headerShown: false }}
    >
      {!user ? (
        <Stack.Screen name="Login" component={LoginScreen} />
      ) : (
        <>
          <Stack.Screen name="MainTabs" component={MainTabNavigator} />
          <Stack.Screen name="AddCatProfile" component={AddCatProfileScreen} />
          <Stack.Screen
            name="FoodManagement"
            component={FoodManagementScreen}
          />
        </>
      )}
    </Stack.Navigator>
  );
}
