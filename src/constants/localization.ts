export const BREED_OPTIONS = [
  { value: 'Abyssinian', label: '阿比西尼亞貓' },
  { value: 'American Shorthair', label: '美國短毛貓' },
  { value: 'Bengal', label: '孟加拉貓' },
  { value: 'Birman', label: '伯曼貓' },
  { value: 'British Shorthair', label: '英國短毛貓' },
  { value: 'Burmese', label: '緬甸貓' },
  { value: 'Devon Rex', label: '德文帝王貓' },
  { value: 'Domestic Shorthair', label: '家貓短毛' },
  { value: 'Domestic Longhair', label: '家貓長毛' },
  { value: 'Egyptian Mau', label: '埃及貓' },
  { value: 'Himalayan', label: '喜馬拉雅貓' },
  { value: 'Maine Coon', label: '緬因貓' },
  { value: 'Manx', label: '曼島貓' },
  { value: 'Norwegian Forest Cat', label: '挪威森林貓' },
  { value: 'Ocicat', label: '歐西貓' },
  { value: 'Persian', label: '波斯貓' },
  { value: 'Ragdoll', label: '布偶貓' },
  { value: 'Russian Blue', label: '俄羅斯藍貓' },
  { value: 'Scottish Fold', label: '蘇格蘭摺耳貓' },
  { value: 'Siamese', label: '暹羅貓' },
  { value: 'Siberian', label: '西伯利亞貓' },
  { value: 'Sphynx', label: '斯芬克斯貓' },
  { value: 'Turkish Angora', label: '土耳其安哥拉貓' },
  { value: 'Exotic Shorthair', label: '異國短毛貓' },
  { value: 'Burmilla', label: '緬因貓斜體慎誤用，正確為「波米拉貓」' },
  { value: 'American Curl', label: '美國捲耳貓' },
  { value: 'Balinese', label: '巴里貓' },
  { value: 'Russian White', label: '俄羅斯白貓' },
  { value: 'Colorpoint Shorthair', label: '色點短毛貓' },
  { value: 'Tonkinese', label: '東奇貓' },
  { value: 'Burmilla', label: '波米拉貓' },
  { value: 'DomesticShorthairBrown', label: '啡色唐貓／棕色唐貓' },
  { value: 'DomesticShorthairCalico', label: '三色唐貓／三花貓' },
  { value: 'DomesticShorthairPiebald', label: '梨花貓／黑白花貓' },
  { value: 'Other', label: '其他' },
] as const;

export const BREED_LABELS = BREED_OPTIONS.reduce<Record<string, string>>(
  (labels, option) => {
    labels[option.value] = option.label;
    return labels;
  },
  {}
);

export const GENDER_OPTIONS = [
  { label: '♂ 男仔', value: 'male' },
  { label: '♀ 女仔', value: 'female' },
  { label: '？ 未知', value: 'unknown' },
] as const;

export const GENDER_LABELS: Record<'male' | 'female' | 'unknown', string> = {
  male: '男仔',
  female: '女仔',
  unknown: '未知',
};

export const LITTER_TYPE_LABELS: Record<'clean' | 'dirty' | 'vomit', string> = {
  clean: '正常',
  dirty: '便便',
  vomit: '嘔吐',
};

export const LITTER_TYPE_OPTION_LABELS: Record<'clean' | 'dirty' | 'vomit', string> = {
  clean: '✅ 正常',
  dirty: '💩 便便',
  vomit: '🤢 嘔吐',
};

export const WATER_PRESET_LABELS = {
  50: '50 ml',
  100: '100 ml',
  150: '150 ml',
  200: '200 ml',
  350: '350 ml',
} as const;

export const MEAL_CATEGORY_LABELS = {
  dry: '乾糧',
  wet: '濕糧',
  snack: '零食',
} as const;

export const MEAL_CATEGORY_ICONS = {
  dry: '🟤',
  wet: '🥣',
  snack: '🍗',
} as const;

export const LITTER_KIND_LABELS = {
  wee: '尿尿',
  poo: '便便',
} as const;

export const LITTER_SIZE_LABELS = {
  small: '細小',
  medium: '中等',
  large: '較大',
  extraLarge: '很大',
} as const;

export const LITTER_SIZE_DESCRIPTIONS = {
  small: '約如葡萄或乒乓球',
  medium: '約如雞蛋或高爾夫球',
  large: '約如網球',
  extraLarge: '超過網球或拳頭大小 → 可能喝水太多或健康問題',
} as const;

export const LITTER_CONDITION_LABELS = {
  hard: '硬',
  normal: '正常',
  soft: '軟',
} as const;

export function getBreedLabel(breed?: string | null): string {
  if (!breed) {
    return '—';
  }

  return BREED_LABELS[breed] ?? breed;
}

export const CARE_ACTION_LABELS: Record<string, string> = {
  nail_cut: '剪指甲',
  flea_treatment: '滴頸',
  vet_visit: '睇獸醫',
  vaccine: '疫苗',
  brushTeeth: '刷牙',
  bath: '洗澡',
  grooming: '梳毛',
  other: '其他',
};

export const CARE_ACTION_ICONS: Record<string, string> = {
  nail_cut: '✂️',
  flea_treatment: '🐜',
  vet_visit: '🏥',
  vaccine: '💉',
  brushTeeth: '🦷',
  bath: '🛁',
  grooming: '💅🪮',
  other: '📝',
};

export const MOOD_LABELS: Record<string, string> = {
  energetic: '精力充沛',
  playful: '愛玩',
  normal: '正常',
  tired: '疲倦',
  anxious: '焦慮',
  sick: '生病',
};

export const MOOD_ICONS: Record<string, string> = {
  energetic: '⚡',
  playful: '🐾',
  normal: '😊',
  tired: '😴',
  anxious: '😰',
  sick: '🤒',
};
