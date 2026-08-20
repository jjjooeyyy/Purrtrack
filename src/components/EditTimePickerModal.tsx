import { Picker } from "@react-native-picker/picker";
import React, { useState } from "react";
import {
    Modal,
    Platform,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from "react-native";

interface EditTimePickerModalProps {
  visible: boolean;
  initialValue: Date;
  onCancel: () => void;
  onConfirm: (value: Date) => void;
  title?: string;
}

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, i) => i);
const MINUTE_OPTIONS = Array.from({ length: 60 }, (_, i) => i);

export default function EditTimePickerModal({
  visible,
  initialValue,
  onCancel,
  onConfirm,
  title = "選擇時間",
}: EditTimePickerModalProps) {
  const [pickerValue, setPickerValue] = useState<Date>(initialValue);

  React.useEffect(() => {
    setPickerValue(initialValue);
  }, [initialValue, visible]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onCancel}
    >
      <View style={styles.pickerOverlay}>
        <View style={styles.pickerSheet}>
          <View style={styles.pickerHeader}>
            <Text style={styles.pickerTitle}>{title}</Text>
            <TouchableOpacity onPress={onCancel}>
              <Text style={styles.pickerCloseText}>取消</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.customTimePickerRow}>
            <View style={styles.customTimeSpinnerWrap}>
              <Picker
                selectedValue={pickerValue.getHours()}
                onValueChange={(value) =>
                  setPickerValue(
                    new Date(
                      pickerValue.getFullYear(),
                      pickerValue.getMonth(),
                      pickerValue.getDate(),
                      Number(value),
                      pickerValue.getMinutes(),
                    ),
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
                    new Date(
                      pickerValue.getFullYear(),
                      pickerValue.getMonth(),
                      pickerValue.getDate(),
                      pickerValue.getHours(),
                      Number(value),
                    ),
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

          <View style={styles.pickerActionRow}>
            <TouchableOpacity
              style={[styles.pickerActionBtn, styles.pickerClearBtn]}
              onPress={onCancel}
            >
              <Text style={styles.pickerClearText}>取消</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.pickerActionBtn, styles.pickerConfirmBtn]}
              onPress={() => onConfirm(pickerValue)}
            >
              <Text style={styles.pickerConfirmText}>完成</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  pickerOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.2)",
    justifyContent: "center",
    alignItems: "center",
  },
  pickerSheet: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 20,
    width: 320,
    alignItems: "center",
  },
  pickerHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    width: "100%",
    marginBottom: 12,
  },
  pickerTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#000",
  },
  pickerCloseText: {
    color: "#000",
    fontSize: 16,
  },
  customTimePickerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginVertical: 10,
    width: "100%",
  },
  customTimeSpinnerWrap: {
    width: 100,
  },
  customTimeSpinner: {
    width: 100,
    height: Platform.OS === "ios" ? 180 : 50,
  },
  customTimeSpinnerItem: {
    fontSize: 22,
    color: "#000",
  },
  customTimeDivider: {
    fontSize: 24,
    fontWeight: "bold",
    marginHorizontal: 8,
  },
  pickerActionRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    width: "100%",
    marginTop: 8,
  },
  pickerActionBtn: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 10,
    borderRadius: 8,
  },
  pickerClearBtn: {
    backgroundColor: "#eee",
    marginRight: 8,
  },
  pickerConfirmBtn: {
    backgroundColor: "#7FA655",
    marginLeft: 8,
  },
  pickerClearText: {
    color: "#000",
    fontWeight: "bold",
    fontSize: 16,
  },
  pickerConfirmText: {
    color: "#fff",
    fontWeight: "bold",
    fontSize: 16,
  },
});
