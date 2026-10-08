<template>
  <div class="color-picker">
    <!--
      Палитра FR-T-1: десять фиксированных HEX + произвольный #RRGGBB.
      Свотчи — радиогруппа: выбор одного цвета, доступный с клавиатуры
      (каждая кнопка — обычная button в tab-порядке), поэтому drag/N/A не нужны.
    -->
    <div
      class="color-picker__palette"
      role="radiogroup"
      :aria-label="t('tasks.color')"
    >
      <button
        v-for="swatch in TASK_PALETTE"
        :key="swatch"
        type="button"
        class="color-picker__swatch"
        :class="{ 'color-picker__swatch--selected': isSelected(swatch) }"
        :style="{ backgroundColor: swatch }"
        role="radio"
        :aria-checked="isSelected(swatch)"
        :aria-label="swatch"
        :title="swatch"
        @click="select(swatch)"
      />
    </div>

    <q-input
      v-model="draft"
      dense
      outlined
      maxlength="7"
      class="color-picker__hex"
      :label="t('tasks.customColor')"
      :error="hasError"
      :error-message="t('tasks.validation.color')"
      @update:model-value="onDraft"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { TASK_PALETTE } from 'src/models/task'

/**
 * Выбор цвета дела: палитра FR-T-1 и поле произвольного `#RRGGBB`.
 *
 * Наружу уходит только валидный `#RRGGBB`: незаконченный ввод («#F4») остаётся
 * в поле и не портит модель формы. Полная проверка всё равно есть в
 * validateTaskInput — компонент не подменяет валидатор стора.
 */
const props = defineProps<{ modelValue: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const { t } = useI18n()

const HEX = /^#[0-9A-F]{6}$/i

const draft = ref(props.modelValue)

watch(
  () => props.modelValue,
  value => {
    if (value !== draft.value) draft.value = value
  },
)

/** Ошибку показываем только у законченного ввода: 7 символов и не HEX. */
const hasError = computed(() => draft.value.trim().length >= 7 && !HEX.test(draft.value.trim()))

function isSelected(color: string): boolean {
  return props.modelValue.toUpperCase() === color.toUpperCase()
}

function select(color: string) {
  draft.value = color
  emit('update:modelValue', color)
}

function onDraft(value: string | number | null) {
  const text = String(value ?? '').trim().toUpperCase()
  draft.value = text
  if (HEX.test(text)) emit('update:modelValue', text)
}
</script>

<style scoped>
.color-picker {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
}

.color-picker__palette {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.color-picker__swatch {
  width: 28px;
  height: 28px;
  padding: 0;
  border: 2px solid transparent;
  border-radius: 50%;
  cursor: pointer;
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.12);
}

.color-picker__swatch--selected {
  border-color: #212121;
  box-shadow: 0 0 0 2px #fff inset;
}

.color-picker__hex {
  width: 140px;
}
</style>
