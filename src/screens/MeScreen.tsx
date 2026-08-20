import React, { useEffect, useState } from "react";
import * as Clipboard from "expo-clipboard";
import {
  View,
  Text,
  StyleSheet,
  Image,
  TouchableOpacity,
  ScrollView,
  Alert,
  RefreshControl,
} from "react-native";
import { signOut } from "firebase/auth";
import { useNavigation } from "@react-navigation/native";
import { StackNavigationProp } from "@react-navigation/stack";
import { auth } from "../firebase";
import { RootStackParamList } from "../navigator/RootNavigator";
import { GENDER_LABELS, getBreedLabel } from "../constants/localization";
import { usePetSession } from "../hooks/usePetSession";
import { MeScreenSkeleton } from "../components/ui/skeleton";
import Animated, { FadeIn } from "react-native-reanimated";
import { SharedPetProfile } from "../types";
import { mergeFoodCatalogs } from "../lib/mealCatalog";

type Nav = StackNavigationProp<RootStackParamList>;

function formatBirthday(birthday: { toDate: () => Date } | null): string {
  if (!birthday) return "未設定";
  const d = birthday.toDate();
  return d.toLocaleDateString("zh-HK", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export default function MeScreen() {
  const navigation = useNavigation<Nav>();
  const {
    user,
    profile,
    pets,
    activePet,
    loading: sessionLoading,
    changeActivePet,
  } = usePetSession();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    setLoading(sessionLoading);
  }, [sessionLoading]);

  const onRefresh = async () => {
    setRefreshing(true);
    setRefreshing(false);
  };

  const handleCopyPetId = async (petId: string) => {
    if (petId) {
      await Clipboard.setStringAsync(petId);
      Alert.alert("已複製", "Pet ID 已複製到剪貼簿");
    }
  };

  const handleEditPet = (petId: string) => {
    navigation.navigate("AddCatProfile", {
      editMode: true,
      petId,
      source: "me",
    });
  };

  const handleSwitchPet = async (petId: string) => {
    if (petId !== activePet?.id) {
      await changeActivePet(petId);
    }
  };

  const handleSignOut = () => {
    Alert.alert("登出", "你確定要登出嗎？", [
      { text: "取消", style: "cancel" },
      { text: "登出", style: "destructive", onPress: () => signOut(auth) },
    ]);
  };

  if (loading) {
    return <MeScreenSkeleton />;
  }

  const hasOverflowPets = pets.length > 2;

  // Delete pet handler
  const handleDeletePet = (petId: string) => {
    if (!user) return;
    Alert.alert(
      '刪除寵物',
      '確定要刪除此寵物嗎？此操作無法還原。',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '刪除',
          style: 'destructive',
          onPress: async () => {
            try {
              setLoading(true);
              const { deleteSharedPet } = await import('../lib/pets');
              await deleteSharedPet(petId, user.uid);
              setLoading(false);
            } catch (e) {
              setLoading(false);
              Alert.alert('刪除失敗', '請稍後再試');
            }
          },
        },
      ]
    );
  };

  return (
    <Animated.View entering={FadeIn.duration(300)} style={{ flex: 1 }}>
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor="#7FA655"
        />
      }
    >
      <Text style={styles.title}>設定</Text>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>帳戶</Text>
        <View style={styles.accountRow}>
          {user?.photoURL ? (
            <Image source={{ uri: user.photoURL }} style={styles.avatar} />
          ) : (
            <View style={[styles.avatar, styles.avatarPlaceholder]}>
              <Text style={styles.avatarPlaceholderText}>
                {user?.displayName?.[0]?.toUpperCase() ?? "?"}
              </Text>
            </View>
          )}
          <View style={{ flex: 1 }}>
            <Text style={styles.displayName}>
              {profile?.name ?? user?.displayName ?? "使用者"}
            </Text>
            <Text style={styles.email}>{profile?.email ?? user?.email}</Text>
          </View>
        </View>
      </View>

      <View style={styles.section}>
        <View style={styles.sectionRow}>
          <Text style={styles.sectionTitle}>寵物資料</Text>
          <TouchableOpacity
            onPress={() =>
              navigation.navigate("AddCatProfile", { source: "me" })
            }
          >
            <Text style={styles.editLink}>新增寵物</Text>
          </TouchableOpacity>
        </View>

        {pets.length > 0 ? (
          <View style={styles.scrollViewWrapper}>
            <ScrollView
              nestedScrollEnabled
              showsVerticalScrollIndicator={hasOverflowPets}
              style={[styles.sectionListViewport, styles.petListViewport]}
              contentContainerStyle={styles.petList}
            >
              {pets.map((pet) => (
                <PetCard
                  key={pet.id}
                  pet={pet}
                  isActive={pet.id === activePet?.id}
                  onEdit={() => handleEditPet(pet.id)}
                  onSelect={() => {
                    void handleSwitchPet(pet.id);
                  }}
                  onDelete={() => handleDeletePet(pet.id)}
                />
              ))}
            </ScrollView>
          </View>
        ) : (
          <TouchableOpacity
            style={styles.addCatBtn}
            onPress={() =>
              navigation.navigate("AddCatProfile", { source: "me" })
            }
          >
            <Text style={styles.addCatBtnText}>+ 新增寵物資料</Text>
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.section}>
        <View style={styles.sectionRow}>
          <Text style={styles.sectionTitle}>分享 Pet ID</Text>
        </View>
        <Text style={{ color: "#6b7280", fontSize: 14, marginBottom: 12 }}>
          每隻寵物都有自己的共享代碼。把對應的 Pet ID
          傳給家人朋友，他們就能加入同一份寵物檔案。
        </Text>
        {pets.length > 0 ? (
          <View style={styles.scrollViewWrapper}>
            <ScrollView
              nestedScrollEnabled
              showsVerticalScrollIndicator={hasOverflowPets}
              style={[styles.sectionListViewport, styles.shareListViewport]}
              contentContainerStyle={styles.shareList}
            >
              {pets.map((pet) => (
                <TouchableOpacity
                  activeOpacity={0.8}
                  key={pet.id}
                  style={styles.shareCard}
                  onPress={() => {
                    void handleCopyPetId(pet.id);
                  }}
                >
                  <Text style={styles.sharePetName}>{pet.name}</Text>
                  <Text style={styles.sharePetId} selectable>
                    {pet.id}
                  </Text>
                  <Text style={styles.shareHint}>
                    點擊即可複製這隻寵物的 Pet ID
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        ) : (
          <Text style={styles.emptyHint}>
            建立寵物檔案後，這裡會顯示每隻寵物的 Pet ID。
          </Text>
        )}
      </View>

      {/* {pets.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>食物喜好記錄</Text>
          <View style={styles.scrollViewWrapper}>
            <ScrollView
              nestedScrollEnabled
              showsVerticalScrollIndicator={hasOverflowPets}
              style={[styles.sectionListViewport, styles.petPrefListViewport]}
              contentContainerStyle={styles.petPrefListContent}
            >
              {pets.map((pet, idx) => {
                const mergedFoodCatalog = mergeFoodCatalogs(
                  profile?.sharedFoodCatalog ?? [],
                  pet.foodCatalog ?? [],
                );
                const likedFoods = mergedFoodCatalog.filter(
                  (item) => item.preference === "like",
                );
                const dislikedFoods = mergedFoodCatalog.filter(
                  (item) => item.preference === "dislike",
                );

                return (
                  <View
                    key={pet.id}
                    style={[
                      styles.petPrefCard,
                      idx !== pets.length - 1 && { marginBottom: 18 },
                    ]}
                  >
                    <View style={styles.petPrefHeader}>
                      <View style={styles.petPrefAvatarWrap}>
                        {pet.photoURL ? (
                          <Image
                            source={{ uri: pet.photoURL }}
                            style={styles.petPrefAvatar}
                          />
                        ) : (
                          <View
                            style={[
                              styles.petPrefAvatar,
                              styles.petPrefAvatarPlaceholder,
                            ]}
                          >
                            <Text style={{ fontSize: 24 }}>🐱</Text>
                          </View>
                        )}
                      </View>
                      <Text style={styles.petPrefName}>{pet.name}</Text>
                    </View>
                    <View style={styles.foodPreferenceSummaryContainer}>
                      <View style={styles.foodPreferenceSummarySection}>
                        <View style={styles.foodPrefRowHeader}>
                          <Text style={styles.foodPreferenceSummaryLabel}>
                            😋 鍾意
                          </Text>
                        </View>
                        {likedFoods.length > 0 ? (
                          <View style={styles.foodChipRowBetter}>
                            {likedFoods.map((item) => (
                              <View key={item.id} style={styles.foodChipLike}>
                                <Text style={styles.foodChipText}>{item.name}</Text>
                              </View>
                            ))}
                          </View>
                        ) : (
                          <Text style={styles.emptyHint}>暫時未記錄</Text>
                        )}
                      </View>
                      <View style={styles.foodPreferenceSummarySection}>
                        <View style={styles.foodPrefRowHeader}>
                          <Text style={styles.foodPreferenceSummaryLabel}>
                            🤢 唔鍾意
                          </Text>
                        </View>
                        {dislikedFoods.length > 0 ? (
                          <View style={styles.foodChipRowBetter}>
                            {dislikedFoods.map((item) => (
                              <View key={item.id} style={styles.foodChipDislike}>
                                <Text style={styles.foodChipText}>{item.name}</Text>
                              </View>
                            ))}
                          </View>
                        ) : (
                          <Text style={styles.emptyHint}>暫時未記錄</Text>
                        )}
                      </View>
                    </View>
                  </View>
                );
              })}
            </ScrollView>
          </View>
        </View>
      )} */}

      <TouchableOpacity style={styles.signOutBtn} onPress={handleSignOut}>
        <Text style={styles.signOutText}>登出</Text>
      </TouchableOpacity>
    </ScrollView>
    </Animated.View>
  );
}

function PetCard({
  pet,
  isActive,
  onEdit,
  onSelect,
  onDelete,
}: {
  pet: SharedPetProfile;
  isActive: boolean;
  onEdit: () => void;
  onSelect: () => void;
  onDelete: () => void;
}) {
  return (
    <View style={[styles.petCard, isActive && styles.petCardActive]}>
      <View style={styles.petCardTopRow}>
        <View style={styles.petCardIdentity}>
          {pet.photoURL ? (
            <Image source={{ uri: pet.photoURL }} style={styles.catPhoto} />
          ) : (
            <View style={[styles.catPhoto, styles.catPhotoPlaceholder]}>
              <Text style={{ fontSize: 32 }}>🐱</Text>
            </View>
          )}
          <View style={{ flex: 1, gap: 6 }}>
            <View style={styles.petCardTitleRow}>
              <Text style={styles.catName}>{pet.name}</Text>
              {isActive ? (
                <Text style={styles.activeBadge}>目前使用中</Text>
              ) : null}
            </View>
            <InfoRow label="生日" value={formatBirthday(pet.birthday)} />
            <InfoRow
              label="體重"
              value={pet.weight ? `${pet.weight} 公斤` : "—"}
            />
            <InfoRow label="性別" value={GENDER_LABELS[pet.gender]} />
          </View>
        </View>
      </View>

      <View style={styles.petCardActions}>
        <TouchableOpacity style={styles.secondaryBtn} onPress={onEdit}>
          <Text style={styles.secondaryBtnText}>編輯資料</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.primaryBtn, isActive && styles.primaryBtnDisabled]}
          onPress={onSelect}
          disabled={isActive}
        >
          <Text style={styles.primaryBtnText}>
            {isActive ? "已選取" : "切換到這隻"}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.deleteBtn}
          onPress={onDelete}
        >
          <Text style={styles.deleteBtnText}>刪除</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F7F4EB" },
  content: { padding: 20, paddingBottom: 120, paddingTop:50},
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  title: {
    fontFamily: "ZenMaruGothic-Bold",
    fontSize: 24,
    color: "#111827",
    marginTop: 52,
    marginBottom: 20,
  },

  section: {
    backgroundColor: "#fafafa",
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#f3f4f6",
  },
  sectionRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  sectionTitle: {
    fontFamily: "ZenMaruGothic-Bold",
    fontSize: 14,
    color: "#6b7280",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 12,
  },
  editLink: {
    fontFamily: "ZenMaruGothic-Medium",
    fontSize: 14,
    color: "#7FA655",
  },

  accountRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  avatar: { width: 52, height: 52, borderRadius: 26 },
  avatarPlaceholder: {
    backgroundColor: "#7FA655",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarPlaceholderText: {
    fontFamily: "ZenMaruGothic-Bold",
    color: "#fff",
    fontSize: 22,
  },
  displayName: {
    fontFamily: "ZenMaruGothic-Medium",
    fontSize: 17,
    color: "#111827",
  },
  email: {
    fontFamily: "ZenMaruGothic-Regular",
    fontSize: 13,
    color: "#6b7280",
    marginTop: 2,
  },
  petList: { gap: 14 },
  sectionListViewport: {
    paddingRight: 4,
  },
  petListViewport: {
    maxHeight: 340,
  },
  petCard: {
    gap: 14,
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#f3f4f6",
    backgroundColor: "#fff",
  },
  petCardActive: {
    borderColor: "#fdba74",
    backgroundColor: "#fffaf3",
  },
  petCardTopRow: { gap: 12 },
  petCardIdentity: { flexDirection: "row", gap: 14, alignItems: "flex-start" },
  petCardTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  activeBadge: {
    fontFamily: "ZenMaruGothic-Bold",
    fontSize: 11,
    color: "#c2410c",
    backgroundColor: "#ffedd5",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  petCardActions: { flexDirection: "row", gap: 10 },
  catPhoto: { width: 72, height: 72, borderRadius: 36 },
  catPhotoPlaceholder: {
    backgroundColor: "#fff7ed",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#fed7aa",
  },
  catName: {
    fontFamily: "ZenMaruGothic-Bold",
    fontSize: 18,
    color: "#111827",
    marginBottom: 4,
  },

  infoRow: { flexDirection: "row", gap: 6 },
  infoLabel: { fontSize: 13, color: "#9ca3af", width: 64 },
  infoValue: { fontSize: 13, color: "#374151", flex: 1 },

  secondaryBtn: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#fed7aa",
    backgroundColor: "#fff7ed",
    alignItems: "center",
    paddingVertical: 12,
  },
  secondaryBtnText: {
    fontFamily: "ZenMaruGothic-Medium",
    color: "#c2410c",
    fontSize: 14,
  },
  primaryBtn: {
    flex: 1,
    borderRadius: 12,
    backgroundColor: "#111827",
    alignItems: "center",
    paddingVertical: 12,
  },
  primaryBtnDisabled: {
    backgroundColor: "#d1d5db",
  },
  primaryBtnText: {
    fontFamily: "ZenMaruGothic-Medium",
    color: "#fff",
    fontSize: 14,
  },

  deleteBtn: {
    flex: 0.7,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#fca5a5',
    backgroundColor: '#fef2f2',
    alignItems: 'center',
    paddingVertical: 12,
    marginLeft: 6,
  },
  deleteBtnText: {
    fontFamily: 'ZenMaruGothic-Medium',
    color: '#dc2626',
    fontSize: 14,
  },

  addCatBtn: {
    borderWidth: 1,
    borderColor: "#7FA655",
    borderRadius: 10,
    borderStyle: "dashed",
    paddingVertical: 14,
    alignItems: "center",
  },
  addCatBtnText: {
    fontFamily: "ZenMaruGothic-Medium",
    color: "#7FA655",
    fontSize: 15,
  },

  shareList: { gap: 10 },
  shareListViewport: {
    maxHeight: 210,
  },
  shareCard: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#fed7aa",
    backgroundColor: "#fff7ed",
    padding: 10,
  },
  sharePetName: {
    fontFamily: "ZenMaruGothic-Bold",
    fontSize: 15,
    color: "#111827",
    marginBottom: 3,
  },
  sharePetId: {
    fontFamily: "ZenMaruGothic-Bold",
    fontSize: 15,
    color: "#ea580c",
  },
  shareHint: {
    fontFamily: "ZenMaruGothic-Regular",
    fontSize: 11,
    color: "#78716c",
    marginTop: 6,
  },
  emptyHint: {
    fontFamily: "ZenMaruGothic-Regular",
    fontSize: 13,
    color: "#9ca3af",
  },
  sectionScrollHint: {
    fontFamily: "ZenMaruGothic-Medium",
    fontSize: 12,
    color: "#7c6f64",
    backgroundColor: "#fff7ed",
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#fed7aa",
  },

  signOutBtn: {
    marginTop: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#7FA655",
    paddingVertical: 12,
    alignItems: "center",
    backgroundColor: "#7FA655",
  },
  signOutText: {
    fontFamily: "ZenMaruGothic-Medium",
    color: "#fff",
    fontSize: 16,
  },
  foodPreferenceSummaryContainer: {
    gap: 18,
  },
  foodPreferenceSummarySection: {
    gap: 10,
  },
  foodPreferenceSummaryLabel: {
    fontFamily: "ZenMaruGothic-Bold",
    fontSize: 14,
    color: "#2563eb",
    letterSpacing: 0.2,
  },
  foodPrefRowHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 2,
  },
  foodChipRowBetter: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginTop: 2,
    marginBottom: 2,
  },
  foodChipLike: {
    backgroundColor: "#ecfdf5",
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: "#34d399",
    marginBottom: 4,
  },
  foodChipDislike: {
    backgroundColor: "#fef2f2",
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: "#f87171",
    marginBottom: 4,
  },
  foodChipText: {
    fontFamily: "ZenMaruGothic-Medium",
    fontSize: 13,
    color: "#374151",
  },
  petPrefCard: {
    backgroundColor: "#fff",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    padding: 18,
    marginBottom: 0,
    shadowColor: "#000",
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  petPrefListViewport: {
    maxHeight: 400,
  },
  petPrefListContent: {
    paddingRight: 2,
  },
  scrollViewWrapper: {
    position: "relative",
  },
  scrollIndicatorOverlay: {
    position: "absolute",
    bottom: 8,
    left: 0,
    right: 0,
    alignItems: "center",
    paddingVertical: 4,
    backgroundColor: "rgba(255, 255, 255, 0.85)",
    borderTopWidth: 1,
    borderTopColor: "rgba(245, 245, 245, 0.6)",
  },
  scrollChevron: {
    fontSize: 16,
    color: "#7FA655",
    fontWeight: "600",
  },
  petPrefHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 10,
  },
  petPrefAvatarWrap: {
    marginRight: 2,
  },
  petPrefAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#f3f4f6",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#e5e7eb",
  },
  petPrefAvatarPlaceholder: {
    backgroundColor: "#f3f4f6",
    alignItems: "center",
    justifyContent: "center",
  },
  petPrefName: {
    fontFamily: "ZenMaruGothic-Bold",
    fontSize: 17,
    color: "#111827",
    letterSpacing: 0.2,
  },
});
