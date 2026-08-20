import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, View, ViewStyle } from "react-native";

const SKELETON_BASE = "#E8E3D8";
const SKELETON_HIGHLIGHT = "#F2EDE4";

interface SkeletonProps {
  width?: number | string;
  height: number;
  borderRadius?: number;
  style?: ViewStyle;
}

export function Skeleton({ width, height, borderRadius = 10, style }: SkeletonProps) {
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.4,
          duration: 750,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 750,
          useNativeDriver: true,
        }),
      ]),
    ).start();
    return () => opacity.stopAnimation();
  }, [opacity]);

  return (
    <Animated.View
      style={[
        {
          width: width ?? "100%",
          height,
          borderRadius,
          backgroundColor: SKELETON_BASE,
          opacity,
        },
        style,
      ]}
    />
  );
}

// ── Compound shapes ────────────────────────────────────────────────────────────

export function SkeletonRow({
  children,
  gap = 10,
  style,
}: {
  children: React.ReactNode;
  gap?: number;
  style?: ViewStyle;
}) {
  return <View style={[{ flexDirection: "row", gap }, style]}>{children}</View>;
}

// ── Screen-level skeletons ─────────────────────────────────────────────────────

/** Full-page shimmer that mirrors HomeScreen layout */
export function HomeScreenSkeleton() {
  return (
    <View style={styles.page}>
      {/* Header row: greeting text + streak badge */}
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 52, marginBottom: 12 }}>
        <View style={{ gap: 6 }}>
          {/* greeting line */}
          <Skeleton width={120} height={16} borderRadius={6} />
          {/* cat name line */}
          <Skeleton width={180} height={22} borderRadius={6} />
        </View>
        {/* streak badge */}
        <Skeleton width={130} height={34} borderRadius={20} />
      </View>

      {/* Pet switcher chips — width:148, avatar:44, total height ~ 70 */}
      <View style={{ marginBottom: 18 }}>
        <SkeletonRow gap={10}>
          {[1, 2].map((i) => (
            <Skeleton key={i} width={148} height={70} borderRadius={16} />
          ))}
        </SkeletonRow>
      </View>

      {/* Section title "今日摘要" */}
      <Skeleton width={72} height={16} borderRadius={5} />

      {/* Summary metric cards */}
      <SkeletonRow>
        {[1, 2, 3].map((i) => (
          <View key={i} style={{ flex: 1 }}>
            <Skeleton height={88} borderRadius={14} />
          </View>
        ))}
      </SkeletonRow>

      {/* Weight hero card */}
      <Skeleton height={84} borderRadius={16} style={{ marginBottom: 4 }} />

      {/* Section title "快速新增" */}
      <Skeleton width={72} height={16} borderRadius={5} />

      {/* Quick action buttons */}
      <SkeletonRow gap={6}>
        {[1, 2, 3, 4].map((i) => (
          <View key={i} style={{ flex: 1 }}>
            <Skeleton height={44} borderRadius={12} />
          </View>
        ))}
      </SkeletonRow>

      {/* Section title "本週趨勢" */}
      <Skeleton width={72} height={16} borderRadius={5} />

      {/* Chart tab row */}
      <Skeleton height={42} borderRadius={12} />

      {/* Chart area */}
      <Skeleton height={180} borderRadius={14} />
    </View>
  );
}

/** Full-page shimmer that mirrors WeightTrackerScreen layout */
export function WeightTrackerSkeleton() {
  return (
    <View style={styles.page}>
      {/* Back button + title area */}
      <View style={{ marginTop: 40, gap: 6, marginBottom: 10 }}>
        <Skeleton width={28} height={28} borderRadius={6} />
        <Skeleton width={200} height={28} borderRadius={8} style={{ marginTop: 6 }} />
      </View>

      {/* Hero card: label + large value + meta + delta badge */}
      <View style={styles.wtHeroCard}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
          <View style={{ gap: 6 }}>
            <Skeleton width={72} height={14} borderRadius={4} />
            <Skeleton width={110} height={32} borderRadius={8} />
            <Skeleton width={160} height={14} borderRadius={4} style={{ marginTop: 8 }} />
          </View>
          <Skeleton width={64} height={32} borderRadius={999} />
        </View>
      </View>

      {/* Form card: title + hint + label + input + label + input + button */}
      <View style={styles.wtFormCard}>
        <Skeleton width={110} height={18} borderRadius={5} />
        <Skeleton width="90%" height={14} borderRadius={4} style={{ marginTop: 8 }} />
        <Skeleton width={72} height={13} borderRadius={4} style={{ marginTop: 14 }} />
        <Skeleton height={46} borderRadius={12} style={{ marginTop: 6 }} />
        <Skeleton width={72} height={13} borderRadius={4} style={{ marginTop: 12 }} />
        <Skeleton height={84} borderRadius={12} style={{ marginTop: 6 }} />
        <Skeleton height={52} borderRadius={14} style={{ marginTop: 14 }} />
      </View>

      {/* Chart card */}
      <View style={styles.wtChartCard}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <Skeleton width={72} height={18} borderRadius={5} />
          <Skeleton width={40} height={14} borderRadius={4} />
        </View>
        <Skeleton height={160} borderRadius={10} />
      </View>

      {/* Section title "最近紀錄" */}
      <Skeleton width={72} height={18} borderRadius={5} />

      {/* Record cards */}
      {[1, 2, 3].map((i) => (
        <View key={i} style={styles.wtRecordCard}>
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <View style={{ gap: 6 }}>
              <Skeleton width={80} height={20} borderRadius={6} />
              <Skeleton width={120} height={12} borderRadius={4} />
            </View>
            <Skeleton width={36} height={20} borderRadius={10} />
          </View>
        </View>
      ))}
    </View>
  );
}

/** Full-page shimmer that mirrors HistoryScreen layout */
export function HistoryScreenSkeleton() {
  return (
    <View style={styles.page}>
      {/* Title line */}
      <Skeleton width={160} height={30} borderRadius={8} />

      {/* Calendar block */}
      <Skeleton height={340} borderRadius={20} style={{ marginTop: 8 }} />

      {/* Legend */}
      <SkeletonRow gap={16} style={{ marginTop: 12 }}>
        <Skeleton width={80} height={20} borderRadius={6} />
        <Skeleton width={80} height={20} borderRadius={6} />
      </SkeletonRow>
    </View>
  );
}

/** Full-page shimmer that mirrors MeScreen layout */
export function MeScreenSkeleton() {
  return (
    <View style={styles.page}>
      {/* Screen title "設定" */}
      <Skeleton width={48} height={26} borderRadius={6} />

      {/* Account section card */}
      <View style={styles.meSectionCard}>
        <Skeleton width={80} height={12} borderRadius={4} style={{ marginBottom: 14 }} />
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <Skeleton width={52} height={52} borderRadius={26} />
          <View style={{ gap: 8 }}>
            <Skeleton width={130} height={18} borderRadius={5} />
            <Skeleton width={160} height={13} borderRadius={4} />
          </View>
        </View>
      </View>

      {/* Pets section card */}
      <View style={styles.meSectionCard}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <Skeleton width={60} height={12} borderRadius={4} />
          <Skeleton width={48} height={14} borderRadius={4} />
        </View>
        {/* Pet cards */}
        {[1, 2].map((i) => (
          <View key={i} style={[styles.mePetCard, i === 2 ? { marginTop: 14 } : {}]}>
            <View style={{ flexDirection: "row", gap: 14, alignItems: "flex-start" }}>
              <Skeleton width={72} height={72} borderRadius={36} />
              <View style={{ flex: 1, gap: 8 }}>
                <Skeleton width="60%" height={18} borderRadius={5} />
                <Skeleton width="40%" height={14} borderRadius={4} />
                <Skeleton width="50%" height={14} borderRadius={4} />
              </View>
            </View>
            <SkeletonRow gap={10}>
              <View style={{ flex: 1 }}><Skeleton height={42} borderRadius={12} /></View>
              <View style={{ flex: 1 }}><Skeleton height={42} borderRadius={12} /></View>
            </SkeletonRow>
          </View>
        ))}
      </View>

      {/* Share Pet ID section */}
      <View style={styles.meSectionCard}>
        <Skeleton width={90} height={12} borderRadius={4} style={{ marginBottom: 14 }} />
        <Skeleton height={48} borderRadius={12} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 120,
    gap: 14,
    backgroundColor: "#F7F4EB",
  },
  meSectionCard: {
    backgroundColor: "#fafafa",
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: "#f3f4f6",
  },
  mePetCard: {
    gap: 14,
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#f3f4f6",
    backgroundColor: "#fff",
  },
  wtHeroCard: {
    backgroundColor: "#fff",
    borderRadius: 20,
    padding: 18,
    borderWidth: 1,
    borderColor: "#E8E3D8",
  },
  wtFormCard: {
    backgroundColor: "#fffdf9",
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: "#ede9e1",
  },
  wtChartCard: {
    backgroundColor: "#fff",
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: "#ede9e1",
  },
  wtRecordCard: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: "#f3f4f6",
  },
});
