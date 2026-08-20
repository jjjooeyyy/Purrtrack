import React, { useEffect, useState } from "react";
import { DefaultTheme, NavigationContainer } from "@react-navigation/native";
import RootNavigator from "./src/navigator/RootNavigator";
import { Alert, Linking, LogBox, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { PetSessionProvider } from "./src/hooks/usePetSession";
import * as Font from "expo-font";
import { scheduleDailyNotificationAt9PM, setupNotificationListeners } from "./src/services/notificationService";

LogBox.ignoreLogs(["Setting a timer", "AsyncStorage has been extracted"]);

const navigationTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: "#F7F4EB",
  },
};

export default function App() {
  const [fontsLoaded, setFontsLoaded] = useState(false);

  useEffect(() => {
    async function loadFonts() {
      await Font.loadAsync({
        "ZenMaruGothic-Light": require("./src/assets/fonts/ZenMaruGothic-Light.ttf"),
        "ZenMaruGothic-Regular": require("./src/assets/fonts/ZenMaruGothic-Regular.ttf"),
        "ZenMaruGothic-Medium": require("./src/assets/fonts/ZenMaruGothic-Medium.ttf"),
        "ZenMaruGothic-Bold": require("./src/assets/fonts/ZenMaruGothic-Bold.ttf"),
        "ZenMaruGothic-Black": require("./src/assets/fonts/ZenMaruGothic-Black.ttf"),
      });
      setFontsLoaded(true);
    }
    loadFonts();
  }, []);

  // Set up notifications
  useEffect(() => {
    const setupNotifications = async () => {
      try {
        await scheduleDailyNotificationAt9PM();
      } catch (error) {
        console.error("Failed to schedule notifications:", error);
      }
    };

    if (fontsLoaded) {
      setupNotifications();
    }
  }, [fontsLoaded]);

  // Listen for notification events
  useEffect(() => {
    const cleanup = setupNotificationListeners(
      (notification) => {
        console.log("Notification received:", notification);
      },
      (response) => {
        console.log("User tapped notification:", response);
        // You can add navigation logic here if needed
      },
    );

    return cleanup;
  }, []);

  // useEffect(() => {
  //   const requestPhotoPermission = async () => {
  //     const currentPermission =
  //       await ImagePicker.getMediaLibraryPermissionsAsync();

  //     if (currentPermission.granted) {
  //       return;
  //     }

  //     const nextPermission =
  //       currentPermission.canAskAgain || currentPermission.status === null
  //         ? await ImagePicker.requestMediaLibraryPermissionsAsync()
  //         : currentPermission;

  //     if (!nextPermission.granted && !nextPermission.canAskAgain) {
  //       Alert.alert(
  //         "需要相片權限",
  //         "請在系統設定中允許相片存取，之後才可上傳寵物頭像。",
  //         [
  //           { text: "取消", style: "cancel" },
  //           {
  //             text: "開啟設定",
  //             onPress: () => {
  //               void Linking.openSettings();
  //             },
  //           },
  //         ],
  //       );
  //     }
  //   };

  //   requestPhotoPermission().catch((error) => {
  //     console.error("Failed to request photo permission on app launch", error);
  //   });
  // }, []);

  return (
    <PetSessionProvider>
      <View style={{ flex: 1, backgroundColor: "#F7F4EB" }}>
        <NavigationContainer theme={navigationTheme}>
          <RootNavigator />
        </NavigationContainer>
      </View>
    </PetSessionProvider>
  );
}
