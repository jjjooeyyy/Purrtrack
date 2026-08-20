import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

// Set notification behavior
Notifications.setNotificationHandler({
    handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: true,
        shouldShowBanner: true,
        shouldShowList: true,
    }),
});

/**
 * Request notification permissions from the user
 */
export const requestNotificationPermissions = async (): Promise<boolean> => {
    if (Platform.OS === "web") {
        console.log("Notifications not available on web");
        return false;
    }

    const { status } = await Notifications.getPermissionsAsync();

    if (status !== "granted") {
        const { status: newStatus } = await Notifications.requestPermissionsAsync();
        return newStatus === "granted";
    }

    return true;
};

/**
 * Schedule a daily notification at 9pm Hong Kong time
 * Hong Kong is UTC+8
 */
export const scheduleDailyNotificationAt9PM = async (): Promise<void> => {
    const granted = await requestNotificationPermissions();
    if (!granted) {
        console.warn("Notification permissions not granted");
        return;
    }

    // Clear any existing notifications first
    await Notifications.cancelAllScheduledNotificationsAsync();

    // Get current time
    const now = new Date();

    // Schedule the notification to repeat daily at 21:00 device local time
    await Notifications.scheduleNotificationAsync({
        content: {
            title: "主子今天過得好嗎？快來記錄一下！",
            body: "別忘了記錄主子的每日狀態 🐾",
            sound: "default",
            badge: 1,
        },
        trigger: {
            hour: 21,
            minute: 0,
            repeats: true,
            type: "daily",
        },
    });
    // console.log("Daily notification scheduled for 21:00 local device time.");
};

/**
 * Cancel all scheduled notifications
 */
export const cancelAllNotifications = async (): Promise<void> => {
    await Notifications.cancelAllScheduledNotificationsAsync();
    console.log("All notifications cancelled");
};

/**
 * Set up notification event listeners
 */
export const setupNotificationListeners = (
    onNotificationReceived?: (notification: Notifications.Notification) => void,
    onNotificationPressed?: (response: Notifications.NotificationResponse) => void,
) => {
    // Listen for notifications when app is in foreground
    const notificationListener = Notifications.addNotificationReceivedListener(
        (notification) => {
            console.log("Notification received:", notification);
            onNotificationReceived?.(notification);
        },
    );

    // Listen for notification taps
    const responseListener =
        Notifications.addNotificationResponseReceivedListener((response) => {
            console.log("Notification pressed:", response);
            onNotificationPressed?.(response);
        });

    // Return cleanup function
    return () => {
        notificationListener.remove();
        responseListener.remove();
    };
};
