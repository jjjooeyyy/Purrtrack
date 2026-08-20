import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { doc, runTransaction } from "firebase/firestore";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import {
  MEAL_CATEGORY_ICONS,
  MEAL_CATEGORY_LABELS,
} from "../constants/localization";
import { SCREEN_TOP_CONTENT_PADDING } from "../constants/theme";
import { db } from "../firebase";
import { usePetSession } from "../hooks/usePetSession";
import {
  createFoodCatalogId,
  createSupplementCatalogId,
  mergeFoodCatalogs,
  mergeSupplementCatalogs,
  normalizeFoodName,
  removeFoodCatalogItem,
  removeSupplementCatalogItem,
  sortFoodCatalog,
  sortSupplementCatalog,
  upsertFoodCatalogItem,
  upsertSupplementCatalogItem,
} from "../lib/mealCatalog";
import { formatKcalUnit, KCAL_UNITS } from "../lib/mealKcal";
import {
  FoodPreference,
  MealCategory,
  SavedFood,
  SavedSupplement,
  SharedPetProfile,
} from "../types";

const MEAL_CATEGORIES: MealCategory[] = ["dry", "wet", "snack"];
const FOOD_PREFERENCE_LABELS: Record<FoodPreference, string> = {
  like: "鍾意",
  neutral: "一般",
  dislike: "唔鍾意",
};
const FOOD_PREFERENCE_ICONS: Record<FoodPreference, string> = {
  like: "😋",
  neutral: "😐",
  dislike: "🤢",
};

function getFoodPreferenceBadgeStyle(preference: FoodPreference) {
  if (preference === "like") {
    return {
      container: styles.foodPreferenceBadgeLike,
      text: styles.foodPreferenceBadgeTextLike,
    };
  }
  if (preference === "dislike") {
    return {
      container: styles.foodPreferenceBadgeDislike,
      text: styles.foodPreferenceBadgeTextDislike,
    };
  }
  return {
    container: styles.foodPreferenceBadgeNeutral,
    text: styles.foodPreferenceBadgeTextNeutral,
  };
}

export default function FoodManagementScreen() {
  const navigation = useNavigation<any>();
  const { user, pets, activePet, profile, refresh, updateSharedCatalogs } =
    usePetSession();
  const [foodCatalog, setFoodCatalog] = useState<SavedFood[]>([]);
  const [catalogCategory, setCatalogCategory] = useState<MealCategory>("wet");
  const [catalogName, setCatalogName] = useState("");
  const [catalogPreference, setCatalogPreference] =
    useState<FoodPreference | null>(null);
  const [catalogEditingId, setCatalogEditingId] = useState<string | null>(null);
  const [catalogKcalAmount, setCatalogKcalAmount] = useState<
    number | undefined
  >(undefined);
  const [catalogKcalUnit, setCatalogKcalUnit] =
    useState<(typeof KCAL_UNITS)[number]>("kg");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const allPetFoodCatalog = pets.flatMap((pet) =>
      (pet.foodCatalog ?? []).map(
        ({
          id,
          name,
          category,
          brandName,
          kcalAmount,
          kcalUnit,
          preference,
        }) => ({
          id,
          name,
          category,
          ...(brandName ? { brandName } : {}),
          ...(typeof kcalAmount === "number" ? { kcalAmount } : {}),
          ...(kcalUnit ? { kcalUnit } : {}),
          ...(preference ? { preference } : {}),
        }),
      ),
    );

    const merged = mergeFoodCatalogs(
      mergeFoodCatalogs(profile?.sharedFoodCatalog ?? [], allPetFoodCatalog),
      activePet?.foodCatalog ?? [],
    );

    setFoodCatalog((prev) =>
      JSON.stringify(prev) === JSON.stringify(merged) ? prev : merged,
    );
  }, [activePet, pets, profile?.sharedFoodCatalog]);

  const sortedFoodCatalog = useMemo(
    () => sortFoodCatalog(foodCatalog),
    [foodCatalog],
  );

  const filteredFoodCatalog = useMemo(
    () => sortedFoodCatalog.filter((item) => item.category === catalogCategory),
    [sortedFoodCatalog, catalogCategory],
  );

  const resetCatalogEditor = useCallback(() => {
    setCatalogCategory("wet");
    setCatalogName("");
    setCatalogPreference(null);
    setCatalogEditingId(null);
    setCatalogKcalAmount(undefined);
    setCatalogKcalUnit("kg");
  }, []);

  const handleEditCatalogItem = useCallback((item: SavedFood) => {
    setCatalogCategory(item.category);
    setCatalogName(item.name);
    setCatalogPreference(item.preference ?? null);
    setCatalogKcalAmount(item.kcalAmount);
    setCatalogKcalUnit(item.kcalUnit ?? "kg");
    setCatalogEditingId(item.id);
  }, []);

  const [supplementCatalog, setSupplementCatalog] = useState<SavedSupplement[]>(
    [],
  );
  const [supName, setSupName] = useState("");
  const [supEditingId, setSupEditingId] = useState<string | null>(null);
  const [supSaving, setSupSaving] = useState(false);

  useEffect(() => {
    const merged = mergeSupplementCatalogs(
      mergeSupplementCatalogs(
        profile?.sharedSupplementCatalog ?? [],
        pets.flatMap((pet) => pet.supplementCatalog ?? []),
      ),
      [],
    );
    setSupplementCatalog((prev) =>
      JSON.stringify(prev) === JSON.stringify(merged) ? prev : merged,
    );
  }, [profile?.sharedSupplementCatalog, pets]);

  const sortedSupplementCatalog = useMemo(
    () => sortSupplementCatalog(supplementCatalog),
    [supplementCatalog],
  );

  const resetSupEditor = useCallback(() => {
    setSupName("");
    setSupEditingId(null);
  }, []);

  const handleEditSupplement = useCallback((item: SavedSupplement) => {
    setSupName(item.name);
    setSupEditingId(item.id);
  }, []);

  const handleSaveSupplement = useCallback(async () => {
    if (!user) {
      Alert.alert("尚未登入", "請先登入後再管理補充品。");
      return;
    }

    const normalizedName = normalizeFoodName(supName);
    if (!normalizedName) {
      Alert.alert("資料無效", "請輸入補充品名稱。");
      return;
    }

    setSupSaving(true);
    try {
      const userRef = doc(db, "users", user.uid);
      const petRef = activePet ? doc(db, "pets", activePet.id) : null;
      let nextSharedCatalog: SavedSupplement[] = [];

      await runTransaction(db, async (transaction) => {
        const userSnap = await transaction.get(userRef);
        const petSnap = petRef ? await transaction.get(petRef) : null;
        const currentUserProfile = userSnap.exists() ? userSnap.data() : {};
        const currentPet = petSnap
          ? ({ id: petSnap.id, ...petSnap.data() } as SharedPetProfile)
          : null;
        const currentSharedCatalog = Array.isArray(
          currentUserProfile.sharedSupplementCatalog,
        )
          ? (currentUserProfile.sharedSupplementCatalog as SavedSupplement[])
          : [];

        const duplicate = currentSharedCatalog.find(
          (item) =>
            item.id !== supEditingId &&
            normalizeFoodName(item.name).toLowerCase() ===
              normalizedName.toLowerCase(),
        );
        if (duplicate) {
          throw new Error("已經有相同的補充品名稱。");
        }

        const nextId = supEditingId ?? createSupplementCatalogId();
        const item: SavedSupplement = {
          id: nextId,
          name: normalizedName,
        };

        nextSharedCatalog = upsertSupplementCatalogItem(
          currentSharedCatalog,
          item,
        );

        transaction.set(
          userRef,
          { sharedSupplementCatalog: nextSharedCatalog },
          { merge: true },
        );

        if (petRef && currentPet) {
          const currentPetCatalog = currentPet.supplementCatalog ?? [];
          const nextPetCatalog = upsertSupplementCatalogItem(
            currentPetCatalog,
            item,
          );
          transaction.set(
            petRef,
            { supplementCatalog: nextPetCatalog },
            { merge: true },
          );
        }
      });

      updateSharedCatalogs(
        { supplementCatalog: nextSharedCatalog },
        { updateCache: true },
      );
      await refresh();
      resetSupEditor();
    } catch (error) {
      Alert.alert(
        "錯誤",
        error instanceof Error ? error.message : "儲存補充品失敗。",
      );
    } finally {
      setSupSaving(false);
    }
  }, [
    activePet,
    refresh,
    resetSupEditor,
    supEditingId,
    supName,
    updateSharedCatalogs,
    user,
  ]);

  const handleRemoveSupplement = useCallback(
    async (item: SavedSupplement) => {
      if (!user) return;

      Alert.alert(
        "確認刪除",
        `確定要刪除「${item.name}」這個補充品嗎？此操作無法還原。`,
        [
          { text: "取消", style: "cancel" },
          {
            text: "刪除",
            style: "destructive",
            onPress: async () => {
              try {
                const userRef = doc(db, "users", user.uid);
                const petRef = activePet
                  ? doc(db, "pets", activePet.id)
                  : null;
                let nextSharedCatalog: SavedSupplement[] = [];

                await runTransaction(db, async (transaction) => {
                  const userSnap = await transaction.get(userRef);
                  const petSnap = petRef
                    ? await transaction.get(petRef)
                    : null;
                  const currentUserProfile = userSnap.exists()
                    ? userSnap.data()
                    : {};
                  const currentPet = petSnap
                    ? ({
                        id: petSnap.id,
                        ...petSnap.data(),
                      } as SharedPetProfile)
                    : null;
                  const currentSharedCatalog = Array.isArray(
                    currentUserProfile.sharedSupplementCatalog,
                  )
                    ? (currentUserProfile.sharedSupplementCatalog as SavedSupplement[])
                    : [];

                  nextSharedCatalog = removeSupplementCatalogItem(
                    currentSharedCatalog,
                    item.id,
                  );

                  transaction.set(
                    userRef,
                    { sharedSupplementCatalog: nextSharedCatalog },
                    { merge: true },
                  );

                  if (petRef && currentPet) {
                    const currentPetCatalog =
                      currentPet.supplementCatalog ?? [];
                    const nextPetCatalog = removeSupplementCatalogItem(
                      currentPetCatalog,
                      item.id,
                    );
                    transaction.set(
                      petRef,
                      { supplementCatalog: nextPetCatalog },
                      { merge: true },
                    );
                  }
                });

                if (supEditingId === item.id) {
                  resetSupEditor();
                }
                updateSharedCatalogs(
                  { supplementCatalog: nextSharedCatalog },
                  { updateCache: true },
                );
                await refresh();
              } catch (error) {
                Alert.alert(
                  "錯誤",
                  error instanceof Error
                    ? error.message
                    : "刪除補充品失敗。",
                );
              }
            },
          },
        ],
      );
    },
    [activePet, refresh, resetSupEditor, supEditingId, updateSharedCatalogs, user],
  );

  const handleSaveFoodCatalogItem = useCallback(async () => {
    if (!user) {
      Alert.alert("尚未登入", "請先登入後再管理食物。");
      return;
    }

    const normalizedName = normalizeFoodName(catalogName);
    if (!normalizedName) {
      Alert.alert("資料無效", "請輸入食物名稱。");
      return;
    }

    setSaving(true);
    try {
      const userRef = doc(db, "users", user.uid);
      const petRef = activePet ? doc(db, "pets", activePet.id) : null;
      let nextSharedCatalog: SavedFood[] = [];
      let nextPetCatalog: SavedFood[] = [];

      await runTransaction(db, async (transaction) => {
        const userSnap = await transaction.get(userRef);
        const petSnap = petRef ? await transaction.get(petRef) : null;
        const currentUserProfile = userSnap.exists() ? userSnap.data() : {};
        const currentPet = petSnap
          ? ({ id: petSnap.id, ...petSnap.data() } as SharedPetProfile)
          : null;
        const currentSharedCatalog = Array.isArray(
          currentUserProfile.sharedFoodCatalog,
        )
          ? (currentUserProfile.sharedFoodCatalog as SavedFood[])
          : [];
        const currentPetCatalog = currentPet?.foodCatalog ?? [];
        const currentCatalog = mergeFoodCatalogs(
          mergeFoodCatalogs(
            currentSharedCatalog,
            pets.flatMap((pet) =>
              (pet.foodCatalog ?? []).map(
                ({ id, name, category, brandName }) => ({
                  id,
                  name,
                  category,
                  ...(brandName ? { brandName } : {}),
                }),
              ),
            ),
          ),
          currentPetCatalog,
        );

        const duplicate = currentCatalog.find(
          (item) =>
            item.id !== catalogEditingId &&
            item.category === catalogCategory &&
            normalizeFoodName(item.name).toLowerCase() ===
              normalizedName.toLowerCase(),
        );
        if (duplicate) {
          throw new Error("這個分類已經有相同的食物名稱。");
        }

        const nextId = catalogEditingId ?? createFoodCatalogId();
        const sharedItem: SavedFood = {
          id: nextId,
          name: normalizedName,
          category: catalogCategory,
          ...(typeof catalogKcalAmount === "number"
            ? { kcalAmount: catalogKcalAmount }
            : {}),
          ...(catalogKcalAmount !== undefined
            ? { kcalUnit: catalogKcalUnit }
            : {}),
        };

        nextSharedCatalog = upsertFoodCatalogItem(
          currentSharedCatalog,
          sharedItem,
        );
        nextPetCatalog = activePet
          ? catalogPreference
            ? upsertFoodCatalogItem(currentPetCatalog, {
                ...sharedItem,
                preference: catalogPreference,
              })
            : removeFoodCatalogItem(currentPetCatalog, nextId)
          : [];

        transaction.set(
          userRef,
          { sharedFoodCatalog: nextSharedCatalog },
          { merge: true },
        );
        if (petRef) {
          transaction.set(
            petRef,
            { foodCatalog: nextPetCatalog },
            { merge: true },
          );
        }
      });

      updateSharedCatalogs({ foodCatalog: nextSharedCatalog });
      setFoodCatalog(
        sortFoodCatalog(mergeFoodCatalogs(nextSharedCatalog, nextPetCatalog)),
      );
      await refresh();
      resetCatalogEditor();
    } catch (error) {
      Alert.alert(
        "錯誤",
        error instanceof Error ? error.message : "儲存食物名稱失敗。",
      );
    } finally {
      setSaving(false);
    }
  }, [
    activePet,
    catalogCategory,
    catalogEditingId,
    catalogKcalAmount,
    catalogKcalUnit,
    catalogName,
    catalogPreference,
    pets,
    refresh,
    resetCatalogEditor,
    updateSharedCatalogs,
    user,
  ]);

  const handleRemoveCatalogItem = useCallback(
    async (item: SavedFood) => {
      if (!user) {
        return;
      }

      Alert.alert(
        "確認刪除",
        `確定要刪除「${item.name}」這個食物嗎？此操作無法還原。`,
        [
          { text: "取消", style: "cancel" },
          {
            text: "刪除",
            style: "destructive",
            onPress: async () => {
              try {
                const userRef = doc(db, "users", user.uid);
                const petRef = activePet ? doc(db, "pets", activePet.id) : null;
                let nextSharedCatalog: SavedFood[] = [];
                let nextPetCatalog: SavedFood[] = [];

                await runTransaction(db, async (transaction) => {
                  const userSnap = await transaction.get(userRef);
                  const petSnap = petRef ? await transaction.get(petRef) : null;
                  const currentUserProfile = userSnap.exists()
                    ? userSnap.data()
                    : {};
                  const currentPet = petSnap
                    ? ({
                        id: petSnap.id,
                        ...petSnap.data(),
                      } as SharedPetProfile)
                    : null;
                  const currentSharedCatalog = Array.isArray(
                    currentUserProfile.sharedFoodCatalog,
                  )
                    ? (currentUserProfile.sharedFoodCatalog as SavedFood[])
                    : [];
                  const currentPetCatalog = currentPet?.foodCatalog ?? [];
                  nextSharedCatalog = removeFoodCatalogItem(
                    currentSharedCatalog,
                    item.id,
                  );
                  nextPetCatalog = removeFoodCatalogItem(
                    currentPetCatalog,
                    item.id,
                  );
                  transaction.set(
                    userRef,
                    { sharedFoodCatalog: nextSharedCatalog },
                    { merge: true },
                  );
                  if (petRef) {
                    transaction.set(
                      petRef,
                      { foodCatalog: nextPetCatalog },
                      { merge: true },
                    );
                  }
                });

                if (catalogEditingId === item.id) {
                  resetCatalogEditor();
                }
                updateSharedCatalogs({ foodCatalog: nextSharedCatalog });
                setFoodCatalog(
                  sortFoodCatalog(
                    mergeFoodCatalogs(nextSharedCatalog, nextPetCatalog),
                  ),
                );
                await refresh();
              } catch (error) {
                Alert.alert(
                  "錯誤",
                  error instanceof Error ? error.message : "刪除食物名稱失敗。",
                );
              }
            },
          },
        ],
      );
    },
    [
      activePet,
      catalogEditingId,
      refresh,
      resetCatalogEditor,
      updateSharedCatalogs,
      user,
    ],
  );

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={styles.container}
    >
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => {
            if (navigation.canGoBack()) {
              navigation.goBack();
              return;
            }
            navigation.navigate("MainTabs", { screen: "Home" });
          }}
        >
          <Ionicons name="chevron-back" size={20} color="#111827" />
        </TouchableOpacity>
        <View style={styles.headerCard}>
          <View style={{ flex: 1 }}>
            <Text style={styles.heroLabel}>
              {activePet?.name ?? "共用食物管理"}
            </Text>
            <Text style={styles.heroTitle}>食物管理</Text>
            <Text style={styles.heroSubtitle}>
              在這裡集中管理常用食物名稱、熱量，之後在日誌和行程都可以直接套用。
            </Text>
          </View>
        </View>

        <View style={styles.formCard}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>
              {catalogEditingId ? "編輯食物" : "新增食物"}
            </Text>
            {catalogEditingId ? (
              <TouchableOpacity onPress={resetCatalogEditor}>
                <Text style={styles.resetText}>取消編輯</Text>
              </TouchableOpacity>
            ) : null}
          </View>

          <Text style={styles.label}>食物類別</Text>
          <View style={styles.categoryRow}>
            {MEAL_CATEGORIES.map((category) => (
              <TouchableOpacity
                key={category}
                style={[
                  styles.categoryBtn,
                  catalogCategory === category && styles.categoryBtnActive,
                ]}
                onPress={() => setCatalogCategory(category)}
              >
                <Text style={styles.categoryIcon}>
                  {MEAL_CATEGORY_ICONS[category]}
                </Text>
                <Text
                  style={[
                    styles.categoryText,
                    catalogCategory === category && styles.categoryTextActive,
                  ]}
                >
                  {MEAL_CATEGORY_LABELS[category]}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.label}>食物名稱</Text>
          <TextInput
            style={styles.input}
            placeholder="例如 Royal Canin Indoor"
            placeholderTextColor="#94A3B8"
            value={catalogName}
            onChangeText={setCatalogName}
          />

          <Text style={styles.label}>熱量（每單位）</Text>
          <View style={styles.kcalRow}>
            <TextInput
              style={[styles.input, styles.kcalAmountInput]}
              placeholder="例如 350"
              placeholderTextColor="#94A3B8"
              value={
                typeof catalogKcalAmount === "number"
                  ? String(catalogKcalAmount)
                  : ""
              }
              onChangeText={(text) =>
                setCatalogKcalAmount(text === "" ? undefined : Number(text))
              }
              keyboardType="decimal-pad"
            />
            <View style={styles.kcalUnitWrap}>
              {KCAL_UNITS.map((unit) => (
                <TouchableOpacity
                  key={unit}
                  style={[
                    styles.kcalUnitBtn,
                    catalogKcalUnit === unit && styles.kcalUnitBtnActive,
                  ]}
                  onPress={() => setCatalogKcalUnit(unit)}
                >
                  <Text
                    style={[
                      styles.kcalUnitText,
                      catalogKcalUnit === unit && styles.kcalUnitTextActive,
                    ]}
                  >
                    {formatKcalUnit(unit)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
          <Text style={styles.helperText}>
            可選填。輸入後，下次在日誌或行程選擇這個食物時就會自動帶入。
          </Text>

          {/* <Text style={styles.label}>主子反應（選填）</Text>
          <View style={styles.preferenceRow}>
            {(["like", "neutral", "dislike"] as FoodPreference[]).map(
              (preference) => {
                const selected = catalogPreference === preference;
                return (
                  <TouchableOpacity
                    key={preference}
                    style={[
                      styles.preferenceBtn,
                      selected && styles.preferenceBtnActive,
                    ]}
                    onPress={() =>
                      setCatalogPreference((current) =>
                        current === preference ? null : preference,
                      )
                    }
                  >
                    <Text
                      style={[
                        styles.preferenceBtnText,
                        selected && styles.preferenceBtnTextActive,
                      ]}
                    >
                      {FOOD_PREFERENCE_ICONS[preference]}{" "}
                      {FOOD_PREFERENCE_LABELS[preference]}
                    </Text>
                  </TouchableOpacity>
                );
              },
            )}
          </View> */}

          <View style={styles.actionRow}>
            <TouchableOpacity
              style={[styles.actionBtn, styles.cancelBtn]}
              onPress={resetCatalogEditor}
            >
              <Text style={styles.cancelText}>清空</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionBtn, styles.saveBtn]}
              onPress={() => void handleSaveFoodCatalogItem()}
              disabled={saving}
            >
              <Text style={styles.saveText}>
                {saving ? "儲存中..." : catalogEditingId ? "更新" : "新增"}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.listCard}>
          <Text style={styles.sectionTitle}>已儲存名稱</Text>
          {filteredFoodCatalog.length > 0 ? (
            filteredFoodCatalog.map((item) => (
              <View key={item.id} style={styles.listItem}>
                <View style={styles.listItemInfo}>
                  <View style={styles.listItemTitleRow}>
                    <Text style={styles.listItemName}>{item.name}</Text>
                    {item.preference ? (
                      <View
                        style={[
                          styles.foodPreferenceBadge,
                          getFoodPreferenceBadgeStyle(item.preference)
                            .container,
                        ]}
                      >
                        <Text
                          style={[
                            styles.foodPreferenceBadgeText,
                            getFoodPreferenceBadgeStyle(item.preference).text,
                          ]}
                        >
                          {FOOD_PREFERENCE_ICONS[item.preference]}{" "}
                          {FOOD_PREFERENCE_LABELS[item.preference]}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                  <Text style={styles.listItemMeta}>
                    {item.brandName ? `${item.brandName} ・ ` : ""}
                    {item.kcalAmount && item.kcalAmount > 0
                      ? `kcal: ${item.kcalAmount} ${formatKcalUnit(item.kcalUnit ?? "kg")}`
                      : "未設定熱量"}
                  </Text>
                  <Text style={styles.listItemSubMeta}>
                    {MEAL_CATEGORY_LABELS[item.category]}
                  </Text>
                </View>
                <View style={styles.listItemActions}>
                  <TouchableOpacity onPress={() => handleEditCatalogItem(item)}>
                    <Text style={styles.editText}>編輯</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => void handleRemoveCatalogItem(item)}
                  >
                    <Text style={styles.deleteText}>刪除</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))
          ) : (
            <View style={styles.emptyListCard}>
              <Text style={styles.emptyListText}>尚未有已儲存的食物名稱。</Text>
            </View>
          )}
        </View>

        {/* Supplement Management */}
        <View style={styles.formCard}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>
              {supEditingId ? "編輯補充品" : "新增補充品"}
            </Text>
            {supEditingId ? (
              <TouchableOpacity onPress={resetSupEditor}>
                <Text style={styles.resetText}>取消編輯</Text>
              </TouchableOpacity>
            ) : null}
          </View>

          <Text style={styles.label}>補充品名稱</Text>
          <TextInput
            style={styles.input}
            placeholder="例如 魚油、益生菌"
            placeholderTextColor="#94A3B8"
            value={supName}
            onChangeText={setSupName}
          />

          <View style={styles.actionRow}>
            <TouchableOpacity
              style={[styles.actionBtn, styles.cancelBtn]}
              onPress={resetSupEditor}
            >
              <Text style={styles.cancelText}>清空</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionBtn, styles.saveBtn]}
              onPress={() => void handleSaveSupplement()}
              disabled={supSaving}
            >
              <Text style={styles.saveText}>
                {supSaving ? "儲存中..." : supEditingId ? "更新" : "新增"}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.listCard}>
          <Text style={styles.sectionTitle}>已儲存補充品</Text>
          {sortedSupplementCatalog.length > 0 ? (
            sortedSupplementCatalog.map((item) => (
              <View key={item.id} style={styles.listItem}>
                <View style={styles.listItemInfo}>
                  <Text style={styles.listItemName}>{item.name}</Text>
                </View>
                <View style={styles.listItemActions}>
                  <TouchableOpacity onPress={() => handleEditSupplement(item)}>
                    <Text style={styles.editText}>編輯</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => void handleRemoveSupplement(item)}
                  >
                    <Text style={styles.deleteText}>刪除</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))
          ) : (
            <View style={styles.emptyListCard}>
              <Text style={styles.emptyListText}>尚未有已儲存的補充品。</Text>
            </View>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F7F4EB" },
  content: {
    paddingHorizontal: 20,
    paddingTop: SCREEN_TOP_CONTENT_PADDING,
    paddingBottom: 120,
    gap: 18,
  },
  backBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 15,
    borderWidth: 1.5,
    borderColor: "#DDD2C3",
    backgroundColor: "#FFF8EF",
    shadowColor: "#2c231a",
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
  backBtnText: {
    fontFamily: "ZenMaruGothic-Medium",
    fontSize: 13,
    color: "#111827",
  },
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F7F4EB",
    paddingHorizontal: 28,
  },
  emptyEmoji: { fontSize: 42, marginBottom: 12 },
  emptyTitle: {
    fontFamily: "ZenMaruGothic-Bold",
    fontSize: 24,
    color: "#111827",
    marginBottom: 10,
  },
  emptySubtitle: {
    fontFamily: "ZenMaruGothic-Regular",
    fontSize: 14,
    lineHeight: 22,
    color: "#475569",
    textAlign: "center",
  },
  headerCard: {
    position: "relative",
    overflow: "hidden",
    backgroundColor: "#172421",
    borderRadius: 28,
    padding: 20,
    gap: 12,
    borderWidth: 1.5,
    borderColor: "rgba(23,36,33,0.3)",
    shadowColor: "#2c231a",
    shadowOpacity: 0.14,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 6,
  },
  heroLabel: {
    fontFamily: "ZenMaruGothic-Medium",
    color: "#d8eee8",
    fontSize: 12,
    letterSpacing: 1.6,
    textTransform: "uppercase",
  },
  heroTitle: {
    fontFamily: "ZenMaruGothic-Bold",
    color: "#FFFFFF",
    fontSize: 30,
    marginTop: 2,
  },
  heroSubtitle: {
    fontFamily: "ZenMaruGothic-Regular",
    color: "#D1D5DB",
    fontSize: 14,
    lineHeight: 22,
    marginTop: 6,
  },
  formCard: {
    backgroundColor: "#FFF9EF",
    borderRadius: 24,
    padding: 16,
    gap: 12,
    borderWidth: 1.5,
    borderColor: "#DDD2C3",
    shadowColor: "#2c231a",
    shadowOpacity: 0.08,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sectionTitle: {
    fontFamily: "ZenMaruGothic-Bold",
    fontSize: 18,
    color: "#111827",
  },
  resetText: {
    fontFamily: "ZenMaruGothic-Medium",
    fontSize: 13,
    color: "#258B5C",
  },
  label: {
    fontFamily: "ZenMaruGothic-Bold",
    fontSize: 13,
    color: "#334155",
    marginTop: 4,
  },
  categoryRow: { flexDirection: "row", gap: 10 },
  categoryBtn: {
    flex: 1,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: "#DDD2C3",
    paddingVertical: 12,
    alignItems: "center",
    gap: 6,
    backgroundColor: "#FFFDF6",
  },
  categoryBtnActive: { borderColor: "#258B5C", backgroundColor: "#E8F5E8" },
  categoryIcon: { fontSize: 20 },
  categoryText: {
    fontFamily: "ZenMaruGothic-Medium",
    fontSize: 13,
    color: "#475569",
  },
  categoryTextActive: { color: "#14532d" },
  input: {
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: "#DDD2C3",
    backgroundColor: "#FFFDF6",
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontFamily: "ZenMaruGothic-Regular",
    fontSize: 14,
    color: "#111827",
  },
  kcalRow: { flexDirection: "row", gap: 10, alignItems: "center" },
  kcalAmountInput: { flex: 1 },
  kcalUnitWrap: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  kcalUnitBtn: {
    borderRadius: 16,
    backgroundColor: "#E8F5E8",
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  kcalUnitBtnActive: { backgroundColor: "#258B5C" },
  kcalUnitText: {
    fontFamily: "ZenMaruGothic-Bold",
    fontSize: 12,
    color: "#14532d",
  },
  kcalUnitTextActive: { color: "#FFFFFF" },
  helperText: {
    fontFamily: "ZenMaruGothic-Regular",
    fontSize: 12,
    lineHeight: 18,
    color: "#64748B",
    marginTop: -2,
  },
  preferenceRow: { flexDirection: "row", gap: 8 },
  preferenceBtn: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: "#DDD2C3",
    borderRadius: 14,
    paddingVertical: 10,
    alignItems: "center",
    backgroundColor: "#FFFDF6",
  },
  preferenceBtnActive: { backgroundColor: "#FFF1D6", borderColor: "#258B5C" },
  preferenceBtnText: {
    fontFamily: "ZenMaruGothic-Medium",
    fontSize: 13,
    color: "#6B7280",
  },
  preferenceBtnTextActive: {
    color: "#7FA655",
    fontFamily: "ZenMaruGothic-Bold",
  },
  actionRow: { flexDirection: "row", gap: 10, marginTop: 6 },
  actionBtn: {
    flex: 1,
    borderRadius: 18,
    paddingVertical: 14,
    alignItems: "center",
  },
  cancelBtn: {
    backgroundColor: "#FFFDF6",
    borderWidth: 1.5,
    borderColor: "#DDD2C3",
  },
  saveBtn: { backgroundColor: "#258B5C" },
  cancelText: {
    fontFamily: "ZenMaruGothic-Bold",
    fontSize: 15,
    color: "#334155",
  },
  saveText: {
    fontFamily: "ZenMaruGothic-Bold",
    fontSize: 15,
    color: "#FFFFFF",
  },
  listCard: {
    backgroundColor: "#FFF9EF",
    borderRadius: 24,
    padding: 16,
    gap: 12,
    borderWidth: 1.5,
    borderColor: "#DDD2C3",
  },
  listItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    borderWidth: 1.5,
    borderColor: "#DDD2C3",
    borderRadius: 16,
    backgroundColor: "#FFFDF6",
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  listItemInfo: { flex: 1, gap: 4 },
  listItemTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  listItemName: {
    fontFamily: "ZenMaruGothic-Bold",
    fontSize: 14,
    color: "#111827",
  },
  listItemMeta: {
    fontFamily: "ZenMaruGothic-Regular",
    fontSize: 12,
    color: "#6B7280",
  },
  listItemSubMeta: {
    fontFamily: "ZenMaruGothic-Regular",
    fontSize: 12,
    color: "#258B5C",
  },
  listItemActions: { flexDirection: "row", gap: 12 },
  editText: {
    fontFamily: "ZenMaruGothic-Medium",
    color: "#2563EB",
    fontSize: 13,
  },
  deleteText: {
    fontFamily: "ZenMaruGothic-Medium",
    color: "#DC2626",
    fontSize: 13,
  },
  emptyListCard: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    borderStyle: "dashed",
    padding: 16,
    backgroundColor: "#F8FAFC",
  },
  emptyListText: {
    fontFamily: "ZenMaruGothic-Regular",
    color: "#64748B",
    fontSize: 13,
  },
  foodPreferenceBadge: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  foodPreferenceBadgeLike: { backgroundColor: "#ECFDF5" },
  foodPreferenceBadgeNeutral: { backgroundColor: "#F3F4F6" },
  foodPreferenceBadgeDislike: { backgroundColor: "#FEF2F2" },
  foodPreferenceBadgeText: { fontFamily: "ZenMaruGothic-Bold", fontSize: 11 },
  foodPreferenceBadgeTextLike: { color: "#15803D" },
  foodPreferenceBadgeTextNeutral: { color: "#4B5563" },
  foodPreferenceBadgeTextDislike: { color: "#B91C1C" },
});
