import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import DateTimePicker from "@react-native-community/datetimepicker";
import { Picker } from "@react-native-picker/picker";
import { StackScreenProps } from "@react-navigation/stack";
import * as ImageManipulator from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import * as Linking from "expo-linking";
import * as MediaLibrary from "expo-media-library";
import { Timestamp } from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  BREED_OPTIONS,
  GENDER_OPTIONS,
  getBreedLabel,
} from "../constants/localization";
import { auth, storage } from "../firebase";
import { usePetSession } from "../hooks/usePetSession";
import { mergeFoodCatalogs, normalizeFoodName } from "../lib/mealCatalog";
import { DEFAULT_KCAL_UNIT, formatKcalUnit } from "../lib/mealKcal";
import { createSharedPet, linkUserToPet, updateSharedPet } from "../lib/pets";
import { RootStackParamList } from "../navigator/RootNavigator";
import { FeederConfig, FeederSchedule, SavedFood } from "../types";

type FirebaseLikeError = Error & {
  code?: string;
};

type Props = StackScreenProps<RootStackParamList, "AddCatProfile">;

type FeederScheduleDraft = {
  id: string;
  portion: string;
  unit: FeederSchedule["unit"];
  dispatchTime: string;
  foodName: string;
  kcalAmount: string;
  kcalUnit: FeederSchedule["kcalUnit"];
};

type PickerTarget =
  | { type: "birthday" }
  | { type: "scheduleTime"; scheduleId: string }
  | null;

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, index) => index);
const MINUTE_OPTIONS = Array.from({ length: 60 }, (_, index) => index);
const TIME_PICKER_BASE_YEAR = 2001;
const TIME_PICKER_BASE_MONTH = 0;
const TIME_PICKER_BASE_DAY = 1;

const JOIN_FEATURES = [
  {
    icon: "people-circle-outline" as const,
    title: "和家人一起紀錄",
    description: "共同新增飲食、體重與日常狀態，不必重複建立資料。",
  },
  {
    icon: "sync-outline" as const,
    title: "資料即時同步",
    description: "每位成員看到的是同一隻寵物檔案，更新內容不會分散。",
  },
  {
    icon: "shield-checkmark-outline" as const,
    title: "透過 Pet ID 安全加入",
    description: "只要輸入建立者提供的 Pet ID，就能加入共享照護。",
  },
];

function createDraftSchedule(): FeederScheduleDraft {
  return {
    id: `schedule-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    portion: "",
    unit: "g",
    dispatchTime: "",
    foodName: "",
    kcalAmount: "",
    kcalUnit: DEFAULT_KCAL_UNIT,
  };
}

function parseDateInput(text: string): Date | null {
  const parts = text.split("/");
  if (parts.length !== 3) return null;
  const [d, m, y] = parts.map(Number);
  if (!d || !m || !y || y < 1990 || y > new Date().getFullYear()) return null;
  const date = new Date(y, m - 1, d);
  if (
    Number.isNaN(date.getTime()) ||
    date.getDate() !== d ||
    date.getMonth() !== m - 1 ||
    date.getFullYear() !== y
  ) {
    return null;
  }

  return date;
}

function formatCalendarDate(date: Date): string {
  const day = `${date.getDate()}`.padStart(2, "0");
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

function formatDateInput(date: { toDate: () => Date } | null): string {
  if (!date) return "";
  return formatCalendarDate(date.toDate());
}

function formatTimeInput(date: Date): string {
  const hours = `${date.getHours()}`.padStart(2, "0");
  const minutes = `${date.getMinutes()}`.padStart(2, "0");
  return `${hours}:${minutes}`;
}

function buildTimeValue(hours: number, minutes: number): Date {
  return new Date(
    TIME_PICKER_BASE_YEAR,
    TIME_PICKER_BASE_MONTH,
    TIME_PICKER_BASE_DAY,
    hours,
    minutes,
    0,
    0,
  );
}

function parseTimeInput(text: string): Date {
  const match = text.match(/^([01]\d|2[0-3]):([0-5]\d)$/);

  if (!match) {
    return buildTimeValue(8, 0);
  }

  return buildTimeValue(Number(match[1]), Number(match[2]));
}

function inferImageContentType(uri: string): string {
  const normalizedUri = uri.toLowerCase();

  if (normalizedUri.endsWith(".png")) {
    return "image/png";
  }
  if (normalizedUri.endsWith(".webp")) {
    return "image/webp";
  }
  if (normalizedUri.endsWith(".heic") || normalizedUri.endsWith(".heif")) {
    return "image/heic";
  }

  return "image/jpeg";
}

export default function AddCatProfileScreen({ navigation, route }: Props) {
  const insets = useSafeAreaInsets();
  const editMode = route.params?.editMode ?? false;
  const joinMode = route.params?.joinMode ?? false;
  const showBackButton = route.params?.source === "me";
  const { activePet, pets, profile, refresh } = usePetSession();
  const submissionLockRef = useRef(false);
  const editablePet = editMode
    ? (pets.find((pet) => pet.id === route.params?.petId) ?? activePet)
    : null;
  const [mode, setMode] = useState<"create" | "join">(
    joinMode ? "join" : "create",
  );
  const [name, setName] = useState("");
  const [birthday, setBirthday] = useState("");
  const [breed, setBreed] = useState("");
  const [otherBreed, setOtherBreed] = useState("");
  const [weight, setWeight] = useState("");
  const [gender, setGender] = useState<"male" | "female" | "unknown">(
    "unknown",
  );
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [manipulatedPhotoUri, setManipulatedPhotoUri] = useState<string | null>(
    null,
  );
  const [petId, setPetId] = useState("");
  const [breedModalVisible, setBreedModalVisible] = useState(false);
  const [pickerTarget, setPickerTarget] = useState<PickerTarget>(null);
  const [pickerValue, setPickerValue] = useState(new Date());
  const [autoFeederEnabled, setAutoFeederEnabled] = useState(false);
  const [feederSchedules, setFeederSchedules] = useState<FeederScheduleDraft[]>(
    [],
  );
  const [saving, setSaving] = useState(false);

  const savedFeederFoods = useMemo(
    () =>
      mergeFoodCatalogs(
        profile?.sharedFoodCatalog ?? [],
        pets.flatMap((pet) => pet.foodCatalog ?? []),
      ).filter((item) => normalizeFoodName(item.name).length > 0),
    [pets, profile?.sharedFoodCatalog],
  );

  useEffect(() => {
    if (!editMode || !editablePet) {
      return;
    }

    setMode("create");
    setName(editablePet.name ?? "");
    setBirthday(formatDateInput(editablePet.birthday));
    const isKnownBreed = BREED_OPTIONS.some(
      (option) => option.value === editablePet.breed,
    );
    setBreed(isKnownBreed ? editablePet.breed : "Other");
    setOtherBreed(isKnownBreed ? "" : (editablePet.breed ?? ""));
    setWeight(editablePet.weight ? `${editablePet.weight}` : "");
    setGender(editablePet.gender ?? "unknown");
    setPhotoUri(editablePet.photoURL ?? null);
    setManipulatedPhotoUri(null);
    if (editablePet.feederConfig?.enabled) {
      setAutoFeederEnabled(true);
      setFeederSchedules(
        editablePet.feederConfig.schedules.length > 0
          ? editablePet.feederConfig.schedules.map((schedule) => ({
              id: schedule.id,
              portion: `${schedule.portion}`,
              unit: schedule.unit,
              dispatchTime: schedule.dispatchTime,
              foodName: schedule.foodName ?? "",
              kcalAmount:
                typeof schedule.kcalAmount === "number"
                  ? `${schedule.kcalAmount}`
                  : "",
              kcalUnit: schedule.kcalUnit ?? DEFAULT_KCAL_UNIT,
            }))
          : [createDraftSchedule()],
      );
      return;
    }

    setAutoFeederEnabled(false);
    setFeederSchedules([]);
  }, [editablePet, editMode]);

  useEffect(() => {
    const requestPhotoPermission = async () => {
      const currentPermission =
        await ImagePicker.getMediaLibraryPermissionsAsync();

      if (currentPermission.granted) {
        return;
      }

      const nextPermission =
        currentPermission.canAskAgain || currentPermission.status === null
          ? await ImagePicker.requestMediaLibraryPermissionsAsync()
          : currentPermission;

      if (!nextPermission.granted && !nextPermission.canAskAgain) {
        Alert.alert(
          "需要相片權限",
          "請在系統設定中允許相片存取，之後才可上傳寵物頭像。",
          [
            { text: "取消", style: "cancel" },
            {
              text: "開啟設定",
              onPress: () => {
                void Linking.openSettings();
              },
            },
          ],
        );
      }
    };

    requestPhotoPermission().catch((error) => {
      console.error("Failed to request photo permission on app launch", error);
    });
  }, []);

  const handlePickPhoto = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 1,
    });

    if (!result.canceled && result.assets[0]) {
      setPhotoUri(result.assets[0].uri);
      try {
        const manipResult = await ImageManipulator.manipulateAsync(
          result.assets[0].uri,
          [{ resize: { width: 1024, height: 1024 } }],
          { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG },
        );
        setManipulatedPhotoUri(manipResult.uri);
      } catch (err) {
        console.error(
          "[Image Manipulation] Failed to resize/compress image",
          err,
        );
        setManipulatedPhotoUri(result.assets[0].uri); // fallback
      }
    }
  };

  const uploadPhoto = async (uri: string, scope: string): Promise<string> => {
    try {
      const uploadSource = manipulatedPhotoUri || uri;
      console.log(
        "[Upload] Starting image upload from URI:",
        uploadSource.substring(0, 50),
      );
      let uploadUri = uploadSource;

      if (Platform.OS === "ios" && uploadUri.startsWith("ph://")) {
        console.log(
          "[Upload] Detected iOS ph:// URI, requesting MediaLibrary permission...",
        );
        const permission = await MediaLibrary.requestPermissionsAsync();
        if (!permission.granted) {
          throw new Error("需要照片庫存取權限。請在設定中允許相片存取。");
        }
        try {
          const assetInfo = await MediaLibrary.getAssetInfoAsync(uploadUri);
          if (assetInfo.localUri) {
            uploadUri = assetInfo.localUri;
            console.log(
              "[Upload] Converted to local URI:",
              uploadUri.substring(0, 50),
            );
          } else {
            throw new Error("無法取得圖片本地路徑");
          }
        } catch (err) {
          console.error("[Upload] MediaLibrary conversion failed:", err);
          throw new Error("無法讀取照片，請重試或選擇其他圖片。");
        }
      }

      const response = await fetch(uploadUri);
      if (!response.ok) {
        throw new Error(`圖片讀取失敗 (HTTP ${response.status})`);
      }

      const blob = await response.blob();
      if (!blob || blob.size === 0) {
        throw new Error("圖片檔案為空");
      }

      const fileName = `profile_${Date.now()}.jpg`;
      const storagePath = `${scope}/${fileName}`;
      const contentType = blob.type || inferImageContentType(uploadUri);

      const storageRef = ref(storage, storagePath);
      await uploadBytes(storageRef, blob, { contentType });
      console.log("[Upload] Upload successful, getting download URL...");

      const downloadUrl = await getDownloadURL(storageRef);
      return downloadUrl;
    } catch (e) {
      const error = e as FirebaseLikeError;
      const errorMessage = error?.message ?? "未知錯誤";
      const alertMessage =
        error?.code === "storage/unauthorized"
          ? "Firebase Storage 沒有允許目前登入帳號寫入這個路徑。請先部署 storage.rules，或確認已登入且上傳路徑為 pets/<目前使用者 uid>/..."
          : errorMessage;

      console.error("[Upload] Upload failed:", errorMessage, e);
      Alert.alert(
        "圖片上傳失敗",
        `${alertMessage}\n\n請確認：\n• 已允許照片存取權限\n• 網路連線正常\n• Firebase Storage 規則已部署`,
      );
      throw e;
    }
  };

  const buildFeederConfig = (): FeederConfig | null => {
    if (!autoFeederEnabled) {
      return null;
    }

    if (feederSchedules.length === 0) {
      if (editMode) {
        return { enabled: true, schedules: [] };
      }
      throw new Error("請至少新增一筆自動餵食排程。");
    }

    const schedules = feederSchedules.map((schedule, index) => {
      const portion = parseFloat(schedule.portion);
      if (!schedule.portion || Number.isNaN(portion) || portion <= 0) {
        throw new Error(`第 ${index + 1} 筆排程的份量不正確。`);
      }
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(schedule.dispatchTime.trim())) {
        throw new Error(`第 ${index + 1} 筆排程的時間格式應為 HH:MM。`);
      }

      const foodName = schedule.foodName.trim();
      const kcalAmount = schedule.kcalAmount
        ? Number.parseFloat(schedule.kcalAmount)
        : undefined;
      if (schedule.kcalAmount && (!kcalAmount || Number.isNaN(kcalAmount))) {
        throw new Error(`第 ${index + 1} 筆排程的熱量數值不正確。`);
      }

      return {
        id: schedule.id,
        portion,
        unit: schedule.unit,
        dispatchTime: schedule.dispatchTime.trim(),
        ...(foodName ? { foodName } : {}),
        ...(kcalAmount ? { kcalAmount, kcalUnit: schedule.kcalUnit } : {}),
      };
    });

    return { enabled: true, schedules };
  };

  const handleCreate = async () => {
    const user = auth.currentUser;
    if (!user) return;
    if (saving || submissionLockRef.current) {
      return;
    }
    if (editMode && !editablePet) {
      Alert.alert("錯誤", "找不到可編輯的寵物資料。");
      return;
    }
    if (!name.trim()) {
      Alert.alert("資料未填寫", "請輸入名字。");
      return;
    }

    submissionLockRef.current = true;
    setSaving(true);
    try {
      const shouldUploadNewPhoto =
        !!photoUri && photoUri !== editablePet?.photoURL;
      const photoURL = shouldUploadNewPhoto
        ? await uploadPhoto(photoUri, `pets/${user.uid}`)
        : photoUri;
      const birthdayDate = birthday ? parseDateInput(birthday) : null;
      let feederConfig: FeederConfig | null = null;
      try {
        feederConfig = buildFeederConfig();
      } catch (error) {
        Alert.alert(
          "資料無效",
          error instanceof Error ? error.message : "自動餵食排程格式錯誤。",
        );
        return;
      }
      const petPayload = {
        name: name.trim(),
        birthday: birthdayDate ? Timestamp.fromDate(birthdayDate) : null,
        breed: breed === "Other" ? otherBreed.trim() : breed,
        weight: weight ? parseFloat(weight) : 0,
        gender,
        photoURL: photoURL ?? null,
        feederConfig,
      };

      if (editMode && editablePet) {
        await updateSharedPet({
          petId: editablePet.id,
          ...petPayload,
        });
        await refresh();
        navigation.goBack();
      } else {
        await createSharedPet({
          user,
          ...petPayload,
        });
        await refresh();
        // Reset form state
        setName("");
        setBirthday("");
        setBreed("");
        setOtherBreed("");
        setWeight("");
        setGender("unknown");
        setPhotoUri(null);
        setManipulatedPhotoUri(null);
        setAutoFeederEnabled(false);
        setFeederSchedules([]);
        // Go to Home
        navigation.reset({
          index: 0,
          routes: [{ name: "MainTabs", params: { screen: "Home" } }],
        });
      }
    } catch (e) {
      Alert.alert("錯誤", e instanceof Error ? e.message : "儲存資料失敗。");
    } finally {
      submissionLockRef.current = false;
      setSaving(false);
    }
  };

  const handleJoin = async () => {
    const user = auth.currentUser;
    if (!user) return;
    if (saving || submissionLockRef.current) {
      return;
    }
    if (!petId.trim()) {
      Alert.alert("資料未填寫", "請輸入 Pet ID。");
      return;
    }

    submissionLockRef.current = true;
    setSaving(true);
    try {
      await linkUserToPet({ user, petId: petId.trim(), role: "member" });
      await refresh();
      // Go to Home after join
      navigation.reset({
        index: 0,
        routes: [{ name: "MainTabs", params: { screen: "Home" } }],
      });
    } catch (e) {
      Alert.alert("錯誤", e instanceof Error ? e.message : "加入資料失敗。");
    } finally {
      submissionLockRef.current = false;
      setSaving(false);
    }
  };

  const effectiveBreedLabel = breed
    ? breed === "Other"
      ? "其他"
      : getBreedLabel(breed)
    : "選擇品種";

  const addFeederSchedule = () => {
    setFeederSchedules((current) => [...current, createDraftSchedule()]);
  };

  const closePicker = () => {
    setPickerTarget(null);
  };

  const openBirthdayPicker = () => {
    const existingDate = parseDateInput(birthday);
    setPickerValue(
      existingDate ?? new Date(new Date().getFullYear() - 1, 0, 1),
    );
    setPickerTarget({ type: "birthday" });
  };

  const openScheduleTimePicker = (scheduleId: string, currentValue: string) => {
    setPickerValue(parseTimeInput(currentValue));
    setPickerTarget({ type: "scheduleTime", scheduleId });
  };

  const applyPickerValue = () => {
    if (!pickerTarget) {
      return;
    }

    if (pickerTarget.type === "birthday") {
      setBirthday(formatCalendarDate(pickerValue));
    } else {
      updateFeederSchedule(pickerTarget.scheduleId, {
        dispatchTime: formatTimeInput(pickerValue),
      });
    }

    closePicker();
  };

  const clearPickerValue = () => {
    if (!pickerTarget) {
      return;
    }

    if (pickerTarget.type === "birthday") {
      setBirthday("");
    } else {
      updateFeederSchedule(pickerTarget.scheduleId, {
        dispatchTime: "",
      });
    }

    closePicker();
  };

  const updateFeederSchedule = (
    id: string,
    patch: Partial<Omit<FeederScheduleDraft, "id">>,
  ) => {
    setFeederSchedules((current) =>
      current.map((schedule) =>
        schedule.id === id ? { ...schedule, ...patch } : schedule,
      ),
    );
  };

  const removeFeederSchedule = (id: string) => {
    setFeederSchedules((current) =>
      current.filter((schedule) => schedule.id !== id),
    );
  };

  const toggleAutoFeeder = (enabled: boolean) => {
    setAutoFeederEnabled(enabled);
    setFeederSchedules((current) =>
      enabled ? (current.length > 0 ? current : [createDraftSchedule()]) : [],
    );
  };

  const findSavedFoodForSchedule = (foodName: string): SavedFood | null => {
    const normalizedTarget = normalizeFoodName(foodName).toLowerCase();
    if (!normalizedTarget) {
      return null;
    }

    return (
      savedFeederFoods.find(
        (item) =>
          normalizeFoodName(item.name).toLowerCase() === normalizedTarget,
      ) ?? null
    );
  };

  const handleSelectSavedFood = (scheduleId: string, item: SavedFood) => {
    const currentSchedule = feederSchedules.find(
      (schedule) => schedule.id === scheduleId,
    );
    const isSameSelection =
      currentSchedule !== undefined &&
      findSavedFoodForSchedule(currentSchedule.foodName)?.id === item.id;

    if (isSameSelection) {
      updateFeederSchedule(scheduleId, {
        foodName: "",
        kcalAmount: "",
        kcalUnit: DEFAULT_KCAL_UNIT,
      });
      return;
    }

    updateFeederSchedule(scheduleId, {
      foodName: item.name,
      kcalAmount:
        typeof item.kcalAmount === "number" ? `${item.kcalAmount}` : "",
      kcalUnit: item.kcalUnit ?? DEFAULT_KCAL_UNIT,
    });
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {showBackButton ? (
          <TouchableOpacity
            style={[styles.backButton, { top: insets.top + 22 }]}
            onPress={() => navigation.goBack()}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Ionicons name="chevron-back" size={28} color="#111827" />
          </TouchableOpacity>
        ) : null}

        <Text
          style={[
            styles.title,
            {
              marginTop: showBackButton
                ? insets.top + 48
                : Math.max(insets.top + 24, 48),
            },
          ]}
        >
          {editMode
            ? "編輯寵物資料 🐾"
            : mode === "create"
              ? "新增貓狗資料 🐾"
              : "家庭共享加入 🐾"}
        </Text>
        <Text style={styles.subtitle}>
          {editMode
            ? "更新目前選擇的寵物資料"
            : mode === "create"
              ? "建立新的共享寵物檔案"
              : "使用 Pet ID 加入已建立的寵物，和家人一起同步照護紀錄"}
        </Text>

        {!editMode && (
          <View style={styles.modeRow}>
            <TouchableOpacity
              style={[
                styles.modeBtn,
                mode === "create" && styles.modeBtnActive,
              ]}
              onPress={() => setMode("create")}
            >
              <Text
                style={[
                  styles.modeBtnText,
                  mode === "create" && styles.modeBtnTextActive,
                ]}
              >
                建立寵物檔案
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modeBtn, mode === "join" && styles.modeBtnActive]}
              onPress={() => setMode("join")}
            >
              <Text
                style={[
                  styles.modeBtnText,
                  mode === "join" && styles.modeBtnTextActive,
                ]}
              >
                家庭共享加入
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {mode === "create" ? (
          <>
            <View style={styles.formSectionCard}>
              <Text style={styles.formSectionEyebrow}>基本資料</Text>
              <Text style={styles.formSectionTitle}>先完成毛孩檔案</Text>
              <Text style={styles.formSectionNote}>
                名字、生日、品種和體重會先成為這份寵物檔案的基礎資料。
              </Text>

              <TouchableOpacity
                style={styles.photoContainer}
                onPress={handlePickPhoto}
              >
                {photoUri ? (
                  <Image source={{ uri: photoUri }} style={styles.photo} />
                ) : (
                  <View style={styles.photoPlaceholder}>
                    <Text style={styles.photoPlaceholderIcon}>📷</Text>
                    <Text style={styles.photoPlaceholderText}>新增照片</Text>
                  </View>
                )}
              </TouchableOpacity>

              <Text style={styles.label}>名字 *</Text>
              <TextInput
                style={styles.input}
                placeholder="例如：麻糬"
                value={name}
                onChangeText={setName}
              />

              <Text style={styles.label}>生日（DD/MM/YYYY）</Text>
              <TouchableOpacity
                style={[styles.input, styles.inputTrigger]}
                onPress={openBirthdayPicker}
              >
                <Text
                  style={birthday ? styles.inputText : styles.inputPlaceholder}
                >
                  {birthday || "選擇生日"}
                </Text>
                <Ionicons name="calendar-outline" size={18} color="#6b7280" />
              </TouchableOpacity>

              <Text style={styles.label}>品種</Text>
              <TouchableOpacity
                style={styles.input}
                onPress={() => setBreedModalVisible(true)}
              >
                <Text
                  style={breed ? styles.inputText : styles.inputPlaceholder}
                >
                  {effectiveBreedLabel}
                </Text>
              </TouchableOpacity>
              {breed === "Other" && (
                <TextInput
                  style={[styles.input, { marginTop: 8 }]}
                  placeholder="請輸入品種名稱"
                  value={otherBreed}
                  onChangeText={setOtherBreed}
                />
              )}

              <Text style={styles.label}>體重（公斤）</Text>
              <TextInput
                style={styles.input}
                placeholder="例如：4.5"
                value={weight}
                onChangeText={setWeight}
                keyboardType="decimal-pad"
              />

              <Text style={styles.label}>性別</Text>
              <View style={styles.genderRow}>
                {GENDER_OPTIONS.map((opt) => (
                  <TouchableOpacity
                    key={opt.value}
                    style={[
                      styles.genderBtn,
                      gender === opt.value && styles.genderBtnActive,
                    ]}
                    onPress={() => setGender(opt.value)}
                  >
                    <Text
                      style={[
                        styles.genderBtnText,
                        gender === opt.value && styles.genderBtnTextActive,
                      ]}
                    >
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <View style={styles.feederSection}>
              <Text style={styles.sectionTitle}>自動餵食機</Text>
              <Text style={styles.sectionNote}>
                開啟後可設定多個Schedule, 系統會先建立估算餵食紀錄,
                之後可再修改。
              </Text>
              <View style={styles.toggleRow}>
                <TouchableOpacity
                  style={[
                    styles.toggleBtn,
                    !autoFeederEnabled && styles.toggleBtnActive,
                  ]}
                  onPress={() => toggleAutoFeeder(false)}
                >
                  <Text
                    style={[
                      styles.toggleText,
                      !autoFeederEnabled && styles.toggleTextActive,
                    ]}
                  >
                    沒有
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.toggleBtn,
                    autoFeederEnabled && styles.toggleBtnActive,
                  ]}
                  onPress={() => toggleAutoFeeder(true)}
                >
                  <Text
                    style={[
                      styles.toggleText,
                      autoFeederEnabled && styles.toggleTextActive,
                    ]}
                  >
                    有，使用自動餵食機
                  </Text>
                </TouchableOpacity>
              </View>

              {autoFeederEnabled && editMode ? (
                <View style={styles.feederSummaryCard}>
                  <Text style={styles.feederSummaryTitle}>
                    詳細管理移到Schedule
                  </Text>
                  <Text style={styles.feederSummaryText}>
                    {feederSchedules.length > 0
                      ? `目前已有 ${feederSchedules.length} 筆自動餵食排程。之後可在Schedule頁繼續調整時間、食物和份量。`
                      : "已啟用自動餵食機。之後可在Schedule新增詳細排程。"}
                  </Text>
                  <TouchableOpacity
                    style={styles.feederManageLink}
                    onPress={() =>
                      navigation.navigate("MainTabs", { screen: "Schedule" })
                    }
                  >
                    <Text style={styles.feederManageLinkText}>
                      前往行程頁管理自動餵食機
                    </Text>
                  </TouchableOpacity>
                </View>
              ) : autoFeederEnabled ? (
                <View style={styles.scheduleList}>
                  {feederSchedules.map((schedule, index) => (
                    <View key={schedule.id} style={styles.scheduleCard}>
                      <View style={styles.scheduleHeader}>
                        <Text style={styles.scheduleTitle}>
                          Schedule {index + 1}
                        </Text>
                        <TouchableOpacity
                          onPress={() => removeFeederSchedule(schedule.id)}
                        >
                          <Text style={styles.removeText}>移除</Text>
                        </TouchableOpacity>
                      </View>

                      <Text style={styles.label}>時間（HH:MM）</Text>
                      <TouchableOpacity
                        style={[styles.input, styles.inputTrigger]}
                        onPress={() =>
                          openScheduleTimePicker(
                            schedule.id,
                            schedule.dispatchTime,
                          )
                        }
                      >
                        <Text
                          style={
                            schedule.dispatchTime
                              ? styles.inputText
                              : styles.inputPlaceholder
                          }
                        >
                          {schedule.dispatchTime || "選擇時間"}
                        </Text>
                        <Ionicons
                          name="time-outline"
                          size={18}
                          color="#6b7280"
                        />
                      </TouchableOpacity>

                      {savedFeederFoods.length > 0 && (
                        <View style={styles.savedFoodSection}>
                          <Text style={styles.savedFoodLabel}>常用食物</Text>
                          <View style={styles.savedFoodGrid}>
                            {savedFeederFoods.map((item) => {
                              const isSelected =
                                findSavedFoodForSchedule(schedule.foodName)
                                  ?.id === item.id;

                              return (
                                <TouchableOpacity
                                  key={item.id}
                                  onPress={() =>
                                    handleSelectSavedFood(schedule.id, item)
                                  }
                                  style={[
                                    styles.savedFoodCard,
                                    isSelected && styles.savedFoodCardActive,
                                  ]}
                                >
                                  <View style={styles.savedFoodContent}>
                                    {item.brandName ? (
                                      <Text
                                        style={[
                                          styles.savedFoodBrand,
                                          isSelected &&
                                            styles.savedFoodBrandActive,
                                        ]}
                                        numberOfLines={1}
                                      >
                                        {item.brandName}
                                      </Text>
                                    ) : null}
                                    <Text
                                      style={[
                                        styles.savedFoodName,
                                        isSelected &&
                                          styles.savedFoodNameActive,
                                      ]}
                                      numberOfLines={2}
                                    >
                                      {item.name}
                                    </Text>
                                    {typeof item.kcalAmount === "number" &&
                                      item.kcalAmount > 0 && (
                                        <Text style={styles.savedFoodKcal}>
                                          kcal: {item.kcalAmount}{" "}
                                          {formatKcalUnit(
                                            item.kcalUnit ?? DEFAULT_KCAL_UNIT,
                                          )}
                                        </Text>
                                      )}
                                  </View>
                                </TouchableOpacity>
                              );
                            })}
                          </View>
                        </View>
                      )}

                      <Text style={styles.label}>食物名稱（選填）</Text>
                      <TextInput
                        style={styles.input}
                        placeholder="例如：Royal Canin Indoor"
                        value={schedule.foodName}
                        onChangeText={(value) =>
                          updateFeederSchedule(schedule.id, {
                            foodName: value,
                          })
                        }
                      />

                      <Text style={styles.label}>熱量（選填）</Text>
                      <View style={styles.scheduleRow}>
                        <TextInput
                          style={[styles.input, styles.portionInput]}
                          placeholder="例如：350"
                          value={schedule.kcalAmount}
                          onChangeText={(value) =>
                            updateFeederSchedule(schedule.id, {
                              kcalAmount: value,
                            })
                          }
                          keyboardType="decimal-pad"
                        />
                        <TouchableOpacity
                          style={[
                            styles.unitBtn,
                            schedule.kcalUnit === "kg" && styles.unitBtnActive,
                          ]}
                          onPress={() =>
                            updateFeederSchedule(schedule.id, {
                              kcalUnit: "kg",
                            })
                          }
                        >
                          <Text
                            style={[
                              styles.unitText,
                              schedule.kcalUnit === "kg" &&
                                styles.unitTextActive,
                            ]}
                          >
                            {formatKcalUnit("kg")}
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[
                            styles.unitBtn,
                            schedule.kcalUnit === "100g" &&
                              styles.unitBtnActive,
                          ]}
                          onPress={() =>
                            updateFeederSchedule(schedule.id, {
                              kcalUnit: "100g",
                            })
                          }
                        >
                          <Text
                            style={[
                              styles.unitText,
                              schedule.kcalUnit === "100g" &&
                                styles.unitTextActive,
                            ]}
                          >
                            {formatKcalUnit("100g")}
                          </Text>
                        </TouchableOpacity>
                      </View>

                      <Text style={styles.label}>份量</Text>
                      <View style={styles.scheduleRow}>
                        <TextInput
                          style={[styles.input, styles.portionInput]}
                          placeholder="例如：80"
                          value={schedule.portion}
                          onChangeText={(value) =>
                            updateFeederSchedule(schedule.id, {
                              portion: value,
                            })
                          }
                          keyboardType="decimal-pad"
                        />
                        <TouchableOpacity
                          style={[
                            styles.unitBtn,
                            schedule.unit === "g" && styles.unitBtnActive,
                          ]}
                          onPress={() =>
                            updateFeederSchedule(schedule.id, { unit: "g" })
                          }
                        >
                          <Text
                            style={[
                              styles.unitText,
                              schedule.unit === "g" && styles.unitTextActive,
                            ]}
                          >
                            克
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[
                            styles.unitBtn,
                            schedule.unit === "portion" && styles.unitBtnActive,
                          ]}
                          onPress={() =>
                            updateFeederSchedule(schedule.id, {
                              unit: "portion",
                            })
                          }
                        >
                          <Text
                            style={[
                              styles.unitText,
                              schedule.unit === "portion" &&
                                styles.unitTextActive,
                            ]}
                          >
                            份
                          </Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  ))}

                  <TouchableOpacity
                    style={styles.addScheduleBtn}
                    onPress={addFeederSchedule}
                  >
                    <Text style={styles.addScheduleText}>+ 新增Schedule</Text>
                  </TouchableOpacity>
                </View>
              ) : null}
            </View>

            <TouchableOpacity
              style={styles.saveBtn}
              onPress={handleCreate}
              disabled={saving}
            >
              {saving ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.saveBtnText}>
                  {editMode ? "儲存變更" : "建立並繼續"}
                </Text>
              )}
            </TouchableOpacity>
          </>
        ) : (
          <>
            <View style={styles.joinHeroCard}>
              <View style={styles.joinHeroBadge}>
                <MaterialCommunityIcons
                  name="account-group-outline"
                  size={18}
                  color="#B45309"
                />
                <Text style={styles.joinHeroBadgeText}>Purrtrack 家庭共享</Text>
              </View>

              <Text style={styles.joinHeroTitle}>一隻毛孩，全家一起照顧</Text>
              <Text style={styles.joinHeroDescription}>
                建立者分享 Pet ID 後，家人或伴侶都能加入同一份寵物檔案，
                一起記錄餵食、體重、健康狀況與日常觀察。
              </Text>

              <View style={styles.joinFeatureList}>
                {JOIN_FEATURES.map((item) => (
                  <View key={item.title} style={styles.joinFeatureItem}>
                    <View style={styles.joinFeatureIconWrap}>
                      <Ionicons name={item.icon} size={18} color="#2F855A" />
                    </View>
                    <View style={styles.joinFeatureContent}>
                      <Text style={styles.joinFeatureTitle}>{item.title}</Text>
                      <Text style={styles.joinFeatureDescription}>
                        {item.description}
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            </View>

            <View style={styles.joinInputBlock}>
              <Text style={styles.joinInputLabel}>Pet ID *</Text>
              <Text style={styles.joinInputHint}>
                這是專屬於該寵物檔案的共享代碼，不是使用者帳號。用戶可以在「設定」頁面找到
                Pet ID。
              </Text>
              <View style={styles.joinInputWrap}>
                <MaterialCommunityIcons
                  name="key-chain-variant"
                  size={20}
                  color="#9CA3AF"
                />
                <TextInput
                  style={styles.joinInput}
                  placeholder="例如：AB12CD"
                  autoCapitalize="characters"
                  value={petId}
                  onChangeText={setPetId}
                />
              </View>
            </View>
            <TouchableOpacity
              style={styles.saveBtn}
              onPress={handleJoin}
              disabled={saving}
            >
              {saving ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.saveBtnText}>
                  {editMode ? "儲存變更" : "加入並繼續"}
                </Text>
              )}
            </TouchableOpacity>
          </>
        )}
      </ScrollView>

      <Modal visible={breedModalVisible} animationType="slide" transparent>
        <TouchableOpacity
          style={styles.modalOverlay}
          onPress={() => setBreedModalVisible(false)}
          activeOpacity={1}
        >
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>選擇品種</Text>
            <FlatList
              data={BREED_OPTIONS}
              keyExtractor={(item) => `${item.value}-${item.label}`}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[
                    styles.breedItem,
                    breed === item.value && styles.breedItemActive,
                  ]}
                  onPress={() => {
                    setBreed(item.value);
                    setBreedModalVisible(false);
                  }}
                >
                  <Text
                    style={[
                      styles.breedItemText,
                      breed === item.value && styles.breedItemTextActive,
                    ]}
                  >
                    {item.label}
                  </Text>
                </TouchableOpacity>
              )}
            />
          </View>
        </TouchableOpacity>
      </Modal>

      <Modal
        visible={pickerTarget !== null}
        animationType="slide"
        transparent
        onRequestClose={closePicker}
      >
        <View style={styles.pickerOverlay}>
          <View style={styles.pickerSheet}>
            <View style={styles.pickerHeader}>
              <Text style={styles.pickerTitle}>
                {pickerTarget?.type === "birthday" ? "選擇生日" : "選擇時間"}
              </Text>
              <TouchableOpacity onPress={closePicker}>
                <Text style={styles.pickerCloseText}>取消</Text>
              </TouchableOpacity>
            </View>

            {pickerTarget?.type === "birthday" ? (
              <DateTimePicker
                value={pickerValue}
                mode="date"
                display={Platform.OS === "ios" ? "spinner" : "default"}
                onChange={(_, nextValue) => {
                  if (nextValue) {
                    setPickerValue(nextValue);
                  }
                }}
                {...(Platform.OS === "ios" ? { textColor: "#000" } : {})}
              />
            ) : (
              <View style={styles.customTimePickerRow}>
                <View style={styles.customTimeSpinnerWrap}>
                  <Picker
                    selectedValue={pickerValue.getHours()}
                    onValueChange={(value) =>
                      setPickerValue(
                        buildTimeValue(Number(value), pickerValue.getMinutes()),
                      )
                    }
                    itemStyle={styles.customTimeSpinnerItem}
                    style={styles.customTimeSpinner}
                  >
                    {HOUR_OPTIONS.map((hour) => (
                      <Picker.Item
                        key={`hour-${hour}`}
                        label={`${hour}`.padStart(2, "0")}
                        value={hour}
                      />
                    ))}
                  </Picker>
                </View>

                <Text style={styles.customTimeDivider}>:</Text>

                <View style={styles.customTimeSpinnerWrap}>
                  <Picker
                    selectedValue={pickerValue.getMinutes()}
                    onValueChange={(value) =>
                      setPickerValue(
                        buildTimeValue(pickerValue.getHours(), Number(value)),
                      )
                    }
                    itemStyle={styles.customTimeSpinnerItem}
                    style={styles.customTimeSpinner}
                  >
                    {MINUTE_OPTIONS.map((minute) => (
                      <Picker.Item
                        key={`minute-${minute}`}
                        label={`${minute}`.padStart(2, "0")}
                        value={minute}
                      />
                    ))}
                  </Picker>
                </View>
              </View>
            )}

            <View style={styles.pickerActionRow}>
              <TouchableOpacity
                style={[styles.pickerActionBtn, styles.pickerClearBtn]}
                onPress={clearPickerValue}
              >
                <Text style={styles.pickerClearText}>清除</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.pickerActionBtn, styles.pickerConfirmBtn]}
                onPress={applyPickerValue}
              >
                <Text style={styles.pickerConfirmText}>完成</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F7F4EB" },
  content: { padding: 24, paddingBottom: 48 },
  backButton: {
    position: "absolute",
    left: 20,
    width: 40,
    height: 40,
    // borderRadius: 20,
    // alignItems: "center",
    // justifyContent: "center",
    // backgroundColor: "rgba(255,255,255,0.92)",
    zIndex: 1,
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
    color: "#111827",
    fontFamily: "ZenMaruGothic-Bold",
  },
  subtitle: {
    fontSize: 16,
    color: "#6b7280",
    marginTop: 4,
    marginBottom: 24,
    fontFamily: "ZenMaruGothic-Regular",
  },
  modeRow: { flexDirection: "row", gap: 8, marginBottom: 20 },
  modeBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    alignItems: "center",
    backgroundColor: "#fff",
  },
  modeBtnActive: {
    backgroundColor: "#FFF7ED",
    borderColor: "#7FA655",
    borderWidth: 1,
  },
  modeBtnText: {
    color: "#6b7280",
    fontWeight: "600",
    fontFamily: "ZenMaruGothic-Regular",
  },
  modeBtnTextActive: { color: "#7FA655", fontFamily: "ZenMaruGothic-Regular" },
  photoContainer: { alignSelf: "center", marginBottom: 24 },
  photo: { width: 100, height: 100, borderRadius: 50 },
  formSectionCard: {
    borderRadius: 20,
    padding: 18,
    backgroundColor: "#fffdf7",
    borderWidth: 1,
    borderColor: "#ece7dc",
  },
  formSectionEyebrow: {
    fontSize: 11,
    letterSpacing: 1,
    color: "#9A3412",
    fontFamily: "ZenMaruGothic-Bold",
  },
  formSectionTitle: {
    marginTop: 6,
    fontSize: 20,
    color: "#111827",
    fontFamily: "ZenMaruGothic-Bold",
  },
  formSectionNote: {
    marginTop: 6,
    fontSize: 13,
    lineHeight: 19,
    color: "#6b7280",
    fontFamily: "ZenMaruGothic-Regular",
  },
  photoPlaceholder: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#e5e7eb",
    borderStyle: "dashed",
    fontFamily: "ZenMaruGothic-Regular",
  },
  photoPlaceholderIcon: { fontSize: 28 },
  photoPlaceholderText: {
    fontSize: 12,
    color: "#9ca3af",
    marginTop: 4,
    fontFamily: "ZenMaruGothic-Regular",
  },
  label: {
    fontSize: 14,
    fontWeight: "600",
    color: "#374151",
    marginBottom: 6,
    marginTop: 16,
    fontFamily: "ZenMaruGothic-Regular",
  },
  input: {
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: "#111827",
    backgroundColor: "#fafafa",
    justifyContent: "center",
    fontFamily: "ZenMaruGothic-Regular",
  },
  inputTrigger: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  inputText: {
    fontSize: 16,
    color: "#111827",
    fontFamily: "ZenMaruGothic-Regular",
  },
  inputPlaceholder: {
    fontSize: 16,
    color: "#9ca3af",
    fontFamily: "ZenMaruGothic-Regular",
  },
  genderRow: { flexDirection: "row", gap: 8, marginTop: 4 },
  genderBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    alignItems: "center",
    backgroundColor: "#fafafa",
  },
  genderBtnActive: { backgroundColor: "#fff7ed", borderColor: "#7FA655" },
  genderBtnText: {
    fontSize: 14,
    color: "#6b7280",
    fontFamily: "ZenMaruGothic-Regular",
  },
  genderBtnTextActive: {
    color: "#7FA655",
    fontWeight: "600",
    fontFamily: "ZenMaruGothic-Regular",
  },
  feederSection: {
    marginTop: 24,
    padding: 16,
    borderRadius: 16,
    backgroundColor: "#fafafa",
    borderWidth: 1,
    borderColor: "#f3f4f6",
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#111827",
    fontFamily: "ZenMaruGothic-Bold",
  },
  sectionNote: {
    fontSize: 13,
    color: "#6b7280",
    marginTop: 6,
    lineHeight: 18,
    fontFamily: "ZenMaruGothic-Regular",
  },
  foodCatalogLink: {
    marginTop: 12,
    borderRadius: 14,
    padding: 14,
    backgroundColor: "#F0FDF4",
    borderWidth: 1,
    borderColor: "#BBF7D0",
  },
  foodCatalogLinkTitle: {
    fontFamily: "ZenMaruGothic-Bold",
    fontSize: 14,
    color: "#14532d",
  },
  foodCatalogLinkText: {
    marginTop: 4,
    fontFamily: "ZenMaruGothic-Regular",
    fontSize: 12,
    lineHeight: 18,
    color: "#166534",
  },
  toggleRow: { flexDirection: "row", gap: 8, marginTop: 14 },
  toggleBtn: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    backgroundColor: "#fff",
    alignItems: "center",
  },
  toggleBtnActive: { backgroundColor: "#fff7ed", borderColor: "#7FA655" },
  toggleText: {
    color: "#6b7280",
    fontWeight: "600",
    fontSize: 13,
    textAlign: "center",
    fontFamily: "ZenMaruGothic-Regular",
  },
  toggleTextActive: { color: "#7FA655", fontFamily: "ZenMaruGothic-Regular" },
  scheduleList: { marginTop: 16, gap: 12 },
  scheduleCard: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 12,
    padding: 12,
  },
  savedFoodSection: {
    marginTop: 12,
    marginBottom: 4,
  },
  savedFoodLabel: {
    fontSize: 14,
    color: "#374151",
    marginBottom: 8,
    fontFamily: "ZenMaruGothic-Bold",
  },
  savedFoodGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  savedFoodCard: {
    minWidth: "47%",
    flex: 1,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    backgroundColor: "#ffffff",
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginBottom: 10,
  },
  savedFoodCardActive: {
    borderColor: "#7FA655",
    backgroundColor: "#f0fdf4",
  },
  savedFoodContent: {
    gap: 8,
  },
  savedFoodBrand: {
    fontFamily: "ZenMaruGothic-Medium",
    color: "#6b7280",
    fontSize: 12,
  },
  savedFoodBrandActive: {
    color: "#4D7C0F",
  },
  savedFoodName: {
    fontFamily: "ZenMaruGothic-Bold",
    color: "#111827",
    fontSize: 13,
    lineHeight: 18,
  },
  savedFoodNameActive: {
    color: "#14532d",
  },
  savedFoodKcal: {
    fontSize: 11,
    color: "#7FA655",
    fontFamily: "ZenMaruGothic-Regular",
  },
  scheduleHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  scheduleTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#111827",
    fontFamily: "ZenMaruGothic-Bold",
  },
  removeText: { color: "#dc2626", fontSize: 13, fontWeight: "600" },
  scheduleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  portionInput: { flex: 1 },
  unitBtn: {
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    backgroundColor: "#fafafa",
  },
  unitBtnActive: { backgroundColor: "#fff7ed", borderColor: "#7FA655" },
  unitText: {
    fontSize: 13,
    color: "#6b7280",
    fontWeight: "600",
    fontFamily: "ZenMaruGothic-Regular",
  },
  unitTextActive: { color: "#7FA655", fontFamily: "ZenMaruGothic-Regular" },
  addScheduleBtn: {
    borderRadius: 10,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: "#7FA655",
    paddingVertical: 12,
    alignItems: "center",
    backgroundColor: "#fff",
  },
  addScheduleText: {
    color: "#7FA655",
    fontWeight: "700",
    fontFamily: "ZenMaruGothic-Regular",
  },
  feederSummaryCard: {
    marginTop: 16,
    borderRadius: 14,
    padding: 14,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#D1FAE5",
  },
  feederSummaryTitle: {
    fontSize: 14,
    color: "#14532d",
    fontFamily: "ZenMaruGothic-Bold",
  },
  feederSummaryText: {
    marginTop: 6,
    fontSize: 13,
    lineHeight: 19,
    color: "#4B5563",
    fontFamily: "ZenMaruGothic-Regular",
  },
  feederManageLink: {
    marginTop: 12,
    alignSelf: "flex-start",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: "#14532d",
  },
  feederManageLinkText: {
    fontSize: 13,
    color: "#fff",
    fontFamily: "ZenMaruGothic-Bold",
  },
  saveBtn: {
    marginTop: 32,
    backgroundColor: "#7FA655",
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: "center",
  },
  saveBtnText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
    fontFamily: "ZenMaruGothic-Regular",
  },
  joinHeroCard: {
    marginTop: 10,
    padding: 18,
    borderRadius: 22,
    backgroundColor: "#FFF8EE",
    borderWidth: 1,
    borderColor: "#F6D7A7",
    shadowColor: "#D97706",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 3,
  },
  joinHeroBadge: {
    flexDirection: "row",
    alignSelf: "flex-start",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: "#FDE7C7",
    marginBottom: 14,
  },
  joinHeroBadgeText: {
    color: "#B45309",
    fontSize: 12,
    fontFamily: "ZenMaruGothic-Bold",
  },
  joinHeroTitle: {
    fontSize: 24,
    lineHeight: 34,
    color: "#1F2937",
    fontFamily: "ZenMaruGothic-Bold",
  },
  joinHeroDescription: {
    marginTop: 10,
    fontSize: 14,
    lineHeight: 23,
    color: "#6B7280",
    fontFamily: "ZenMaruGothic-Regular",
  },
  joinFeatureList: {
    marginTop: 18,
    gap: 12,
  },
  joinFeatureItem: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  joinFeatureIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "#E9F7EF",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  joinFeatureContent: {
    flex: 1,
  },
  joinFeatureTitle: {
    fontSize: 14,
    color: "#111827",
    fontFamily: "ZenMaruGothic-Bold",
  },
  joinFeatureDescription: {
    marginTop: 2,
    fontSize: 13,
    lineHeight: 20,
    color: "#6B7280",
    fontFamily: "ZenMaruGothic-Regular",
  },
  joinStepsCard: {
    marginTop: 16,
    padding: 16,
    borderRadius: 18,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  joinStepsTitle: {
    fontSize: 15,
    color: "#111827",
    fontFamily: "ZenMaruGothic-Bold",
  },
  joinStepsList: {
    marginTop: 10,
    gap: 8,
  },
  joinStepText: {
    fontSize: 13,
    lineHeight: 20,
    color: "#4B5563",
    fontFamily: "ZenMaruGothic-Regular",
  },
  joinInputBlock: {
    marginTop: 18,
  },
  joinInputLabel: {
    fontSize: 14,
    color: "#374151",
    marginBottom: 6,
    fontFamily: "ZenMaruGothic-Bold",
  },
  joinInputHint: {
    fontSize: 12,
    lineHeight: 18,
    color: "#78716C",
    marginBottom: 10,
    fontFamily: "ZenMaruGothic-Regular",
  },
  joinInputWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1.5,
    borderColor: "#F6D7A7",
    borderRadius: 14,
    paddingHorizontal: 14,
    backgroundColor: "#FFFDF9",
    minHeight: 54,
  },
  joinInput: {
    flex: 1,
    fontSize: 16,
    color: "#111827",
    fontFamily: "ZenMaruGothic-Regular",
    paddingVertical: 12,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "flex-end",
  },
  modalSheet: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 16,
    maxHeight: "70%",
  },
  pickerOverlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  pickerSheet: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 28,
  },
  pickerHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  pickerTitle: {
    fontSize: 18,
    color: "#111827",
    fontFamily: "ZenMaruGothic-Bold",
  },
  pickerCloseText: {
    fontSize: 14,
    color: "#6b7280",
    fontFamily: "ZenMaruGothic-Regular",
  },
  customTimePickerRow: {
    flexDirection: "row",
    alignItems: "stretch",
    justifyContent: "center",
    marginTop: 8,
  },
  customTimeSpinnerWrap: {
    flex: 1,
    maxWidth: 132,
    height: 216,
    borderRadius: 18,
    overflow: "hidden",
    backgroundColor: "#fafafa",
    borderWidth: 1,
    borderColor: "#e5e7eb",
  },
  customTimeSpinner: {
    flex: 1,
  },
  customTimeSpinnerItem: {
    fontFamily: "ZenMaruGothic-Bold",
    fontSize: 26,
    color: "#111827",
  },
  customTimeDivider: {
    alignSelf: "center",
    marginHorizontal: 10,
    fontFamily: "ZenMaruGothic-Bold",
    fontSize: 30,
    color: "#111827",
  },
  pickerActionRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 16,
  },
  pickerActionBtn: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: "center",
  },
  pickerClearBtn: {
    backgroundColor: "#f3f4f6",
  },
  pickerConfirmBtn: {
    backgroundColor: "#7FA655",
  },
  pickerClearText: {
    color: "#4b5563",
    fontSize: 15,
    fontFamily: "ZenMaruGothic-Regular",
  },
  pickerConfirmText: {
    color: "#fff",
    fontSize: 15,
    fontFamily: "ZenMaruGothic-Bold",
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#111827",
    paddingHorizontal: 20,
    paddingBottom: 12,
    fontFamily: "ZenMaruGothic-Bold",
  },
  breedItem: {
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: "#f3f4f6",
  },
  breedItemActive: { backgroundColor: "#fff7ed" },
  breedItemText: {
    fontSize: 16,
    color: "#374151",
    fontFamily: "ZenMaruGothic-Regular",
  },
  breedItemTextActive: {
    color: "#7FA655",
    fontWeight: "600",
    fontFamily: "ZenMaruGothic-Regular",
  },
});
