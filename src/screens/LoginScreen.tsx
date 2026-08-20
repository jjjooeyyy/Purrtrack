import React, { useEffect, useRef, useState } from "react";
import {
  Animated,
  ActivityIndicator,
  Dimensions,
  Platform,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { makeRedirectUri } from "expo-auth-session";
import * as WebBrowser from "expo-web-browser";
import * as Google from "expo-auth-session/providers/google";
import { auth } from "../firebase";
import { signInWithCredential, GoogleAuthProvider } from "firebase/auth";
import { upsertUserProfile } from "../lib/pets";
import { LinearGradient } from "react-native-linear-gradient";
import { Image } from "expo-image";
import { Ionicons, AntDesign } from "@expo/vector-icons";

WebBrowser.maybeCompleteAuthSession();

const { height } = Dimensions.get("window");
const HERO_HEIGHT = height * 0.44;

const IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
const IOS_REDIRECT_URI = process.env.EXPO_PUBLIC_GOOGLE_IOS_REDIRECT_URI;
const WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;

const FEATURES = [
  { icon: "restaurant-outline" as const, label: "記錄飲食" },
  { icon: "pulse-outline" as const, label: "健康追蹤" },
  { icon: "paw-outline" as const, label: "守護毛孩" },
];

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(false);
  const [isPrompting, setIsPrompting] = useState(false);
  const [error, setError] = useState("");

  // Entrance animations
  const heroOpacity = useRef(new Animated.Value(0)).current;
  const logoScale = useRef(new Animated.Value(0.55)).current;
  const logoOpacity = useRef(new Animated.Value(0)).current;
  const cardTranslateY = useRef(new Animated.Value(90)).current;
  const cardOpacity = useRef(new Animated.Value(0)).current;
  const contentOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.timing(heroOpacity, {
        toValue: 1,
        duration: 380,
        useNativeDriver: true,
      }),
      Animated.parallel([
        Animated.spring(logoScale, {
          toValue: 1,
          tension: 48,
          friction: 7,
          useNativeDriver: true,
        }),
        Animated.timing(logoOpacity, {
          toValue: 1,
          duration: 280,
          useNativeDriver: true,
        }),
      ]),
      Animated.parallel([
        Animated.spring(cardTranslateY, {
          toValue: 0,
          tension: 52,
          friction: 11,
          useNativeDriver: true,
        }),
        Animated.timing(cardOpacity, {
          toValue: 1,
          duration: 380,
          useNativeDriver: true,
        }),
      ]),
      Animated.timing(contentOpacity, {
        toValue: 1,
        duration: 280,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  // Use Expo proxy for development (Expo Go/simulator)
  const [request, response, promptAsync] = Google.useIdTokenAuthRequest({
    iosClientId: IOS_CLIENT_ID,
    webClientId: WEB_CLIENT_ID,
    scopes: ["profile", "email"],
    selectAccount: true,
  });

  useEffect(() => {
    if (response?.type === "success") {
      const idToken = response.params.id_token;
      if (!idToken) {
        setLoading(false);
        setError("Google 沒有回傳 ID token。");
        return;
      }
      setLoading(true);
      const credential = GoogleAuthProvider.credential(idToken);
      signInWithCredential(auth, credential)
        .then(async ({ user }) => {
          await upsertUserProfile(user);
        })
        .catch((e: unknown) => {
          setError(e instanceof Error ? e.message : "無法使用 Google 登入。");
        })
        .finally(() => setLoading(false));
    } else if (response?.type === "dismiss" || response?.type === "cancel") {
      setLoading(false);
    } else if (response?.type === "error") {
      setLoading(false);
      setError("Google 登入失敗");
    }
  }, [response]);

  const handleGoogleLogin = async () => {
    if (!request || loading || isPrompting) return;
    setError("");
    setIsPrompting(true);
    try {
      // Always use proxy for dev/Expo Go
      await promptAsync({ useProxy: true });
    } finally {
      setIsPrompting(false);
    }
  };

  return (
    <View style={styles.root}>
      <StatusBar
        barStyle="light-content"
        translucent
        backgroundColor="transparent"
      />

      {/* ── Hero gradient ── */}
      <Animated.View
        style={[
          styles.heroWrapper,
          { opacity: heroOpacity, paddingTop: insets.top + 16 },
        ]}
      >
        <LinearGradient
          colors={["#246E82", "#7FA655", "#65C27A"]}
          start={{ x: 0.05, y: 0 }}
          end={{ x: 0.95, y: 1 }}
          style={StyleSheet.absoluteFill}
        />

        {/* Decorative translucent blobs */}
        <View style={styles.blob1} />
        <View style={styles.blob2} />
        <View style={styles.blob3} />

        {/* App icon */}
        <Animated.View
          style={[
            styles.logoCard,
            { opacity: logoOpacity, transform: [{ scale: logoScale }] },
          ]}
        >
          <Image
            source={require("../assets/images/splash-icon.png")}
            style={styles.logoImage}
            contentFit="contain"
          />
        </Animated.View>

        <Text
          style={{
            fontFamily: "ZenMaruGothic-Bold",
            color: "#fff",
            fontSize: 32,
            letterSpacing: 0,
            marginHorizontal: 16,
            textAlign: "center",
          }}
          numberOfLines={1}
          adjustsFontSizeToFit
        >
          Purrtrack
        </Text>
        <Animated.Text style={[styles.heroCaption, { opacity: logoOpacity }]}>
          你的毛孩健康管家
        </Animated.Text>
      </Animated.View>

      {/* ── Floating card ── */}
      <Animated.View
        style={[
          styles.card,
          {
            top: HERO_HEIGHT - 30,
            opacity: cardOpacity,
            transform: [{ translateY: cardTranslateY }],
            paddingBottom: Math.max(insets.bottom + 8, 20),
          },
        ]}
      >
        <Animated.View style={{ opacity: contentOpacity }}>
          {/* Card header */}
          <Text style={styles.cardHeading}>歡迎使用 👋</Text>
          <Text style={styles.cardSubtitle}>
            登入後即可記錄毛孩的飲食與健康，{"\n"}隨時掌握牠的生活點滴。
          </Text>

          {/* Feature pills */}
          <View style={styles.featureRow}>
            {FEATURES.map((f) => (
              <View key={f.label} style={styles.featurePill}>
                <Ionicons name={f.icon} size={22} color="#3A9669" />
                <Text style={styles.featureLabel}>{f.label}</Text>
              </View>
            ))}
          </View>

          <View style={{ paddingTop: "15%" }} />

          {/* Google sign-in */}
          {loading ? (
            <ActivityIndicator
              size="large"
              color="#3A9669"
              style={styles.loader}
            />
          ) : (
            <TouchableOpacity
              disabled={!request || isPrompting}
              onPress={handleGoogleLogin}
              style={[
                styles.googleBtn,
                (!request || isPrompting) && styles.googleBtnDisabled,
              ]}
              activeOpacity={0.78}
            >
              <AntDesign name="google" size={20} color="#EA4335" />
              <Text style={styles.googleBtnText}>
                {isPrompting ? "正在開啟 Google…" : "以 Google 帳號繼續"}
              </Text>
            </TouchableOpacity>
          )}

          {!!error && <Text style={styles.errorText}>{error}</Text>}

          {/* Privacy */}
          <Text style={styles.privacyText}>
            繼續即表示你同意我們的{" "}
            <Text style={styles.privacyLink}>服務條款</Text> 與{" "}
            <Text style={styles.privacyLink}>隱私政策</Text>
          </Text>
        </Animated.View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#F7F4EB",
  },

  /* ── Hero ── */
  heroWrapper: {
    height: HERO_HEIGHT,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  blob1: {
    position: "absolute",
    width: 240,
    height: 240,
    borderRadius: 120,
    backgroundColor: "rgba(255,255,255,0.07)",
    top: -70,
    right: -60,
  },
  blob2: {
    position: "absolute",
    width: 160,
    height: 160,
    borderRadius: 80,
    backgroundColor: "rgba(255,255,255,0.05)",
    bottom: 30,
    left: -40,
  },
  blob3: {
    position: "absolute",
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: "rgba(255,255,255,0.09)",
    bottom: 50,
    right: 24,
  },
  logoCard: {
    width: 112,
    height: 112,
    borderRadius: 26,
    backgroundColor: "#FFFEF9",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#0B3320",
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.28,
    shadowRadius: 22,
    elevation: 18,
  },
  logoImage: {
    width: 100,
    height: 100,
  },
  heroTitle: {
    fontFamily: "ZenMaruGothic-Black",
    fontSize: 40,
    color: "#FFFFFF",
    marginTop: 16,
    marginHorizontal: 20,
    // textShadowColor: "rgba(0,0,0,0.15)",
    // textShadowOffset: { width: 0, height: 2 },
    // textShadowRadius: 4,
  },
  heroCaption: {
    fontFamily: "ZenMaruGothic-Regular",
    fontSize: 14,
    color: "rgba(255,255,255,0.78)",
    marginTop: 4,
    letterSpacing: 0.5,
  },

  /* ── Card ── */
  card: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "#FFFEF9",
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    paddingHorizontal: 26,
    paddingTop: 30,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.06,
    shadowRadius: 18,
    elevation: 12,
  },
  cardHeading: {
    fontFamily: "ZenMaruGothic-Bold",
    fontSize: 26,
    color: "#172A1C",
    letterSpacing: -0.3,
  },
  cardSubtitle: {
    fontFamily: "ZenMaruGothic-Regular",
    fontSize: 14,
    color: "#6B8B73",
    marginTop: 8,
    lineHeight: 23,
  },

  /* ── Features ── */
  featureRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 24,
  },
  featurePill: {
    flex: 1,
    alignItems: "center",
    backgroundColor: "#EDF6F0",
    borderRadius: 16,
    paddingVertical: 14,
    gap: 7,
    borderWidth: 1,
    borderColor: "#D4EADB",
  },
  featureLabel: {
    fontFamily: "ZenMaruGothic-Medium",
    fontSize: 12,
    color: "#2E6644",
  },

  /* ── Divider ── */
  dividerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 28,
    marginBottom: 20,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: "#E4E0D6",
  },
  dividerText: {
    fontFamily: "ZenMaruGothic-Light",
    fontSize: 12,
    color: "#A8A29C",
  },

  /* ── Google button ── */
  googleBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    paddingVertical: 17,
    paddingHorizontal: 24,
    borderWidth: 1.5,
    borderColor: "#DDD9D0",
    shadowColor: "#1A2F1E",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.09,
    shadowRadius: 14,
    elevation: 5,
  },
  googleBtnDisabled: {
    opacity: 0.52,
  },
  googleBtnText: {
    fontFamily: "ZenMaruGothic-Medium",
    fontSize: 16,
    color: "#172A1C",
    letterSpacing: 0.2,
  },
  loader: {
    marginVertical: 14,
  },

  /* ── Misc ── */
  errorText: {
    fontFamily: "ZenMaruGothic-Regular",
    color: "#DC2626",
    textAlign: "center",
    marginTop: 14,
    fontSize: 13,
  },
  privacyText: {
    fontFamily: "ZenMaruGothic-Light",
    fontSize: 11,
    color: "#ABA59E",
    textAlign: "center",
    marginTop: 20,
    lineHeight: 18,
  },
  privacyLink: {
    color: "#3A9669",
  },
});
