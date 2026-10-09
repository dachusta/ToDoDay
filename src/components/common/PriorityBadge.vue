<template>
  <!--
    Бейдж приоритета (вайрфреймы §2.1: «●выс», §5.1: подпись в превью).
    Приоритет — ранг low < medium < high < critical, а не алфавит подписи (FR-T-4),
    поэтому цвет и порядок берутся из PRIORITY_STYLE, а не из сортировки строк.
  -->
  <span
    class="priority-badge"
    :class="`priority-badge--${priority}`"
    :title="label"
  >
    <span
      class="priority-badge__dot"
      aria-hidden="true"
    />
    <span class="priority-badge__label">{{ label }}</span>
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Priority } from 'src/models/enums'

const props = defineProps<{ priority: Priority }>()

const { t } = useI18n()

/** Подпись — единственное место, где приоритет превращается в текст (i18n). */
const label = computed(() => t(`priorities.${props.priority}`))
</script>

<style scoped>
.priority-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 1px 8px;
  border-radius: 10px;
  border: 1px solid currentColor;
  font-size: 12px;
  line-height: 18px;
  white-space: nowrap;
}

.priority-badge__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: currentColor;
}

/* Контраст текста к белому фону — не ниже 4.5:1 (НФТ ТЗ §7) */
.priority-badge--low {
  color: #5f6368;
}

.priority-badge--medium {
  color: #1565c0;
}

/* 5.4:1 вместо 3.79:1 у прежнего #e65100: подпись 12 px — мелкий текст, а не
   крупная графика, поэтому порог AA для неё 4.5:1 */
.priority-badge--high {
  color: #bf360c;
}

.priority-badge--critical {
  color: #c62828;
}
</style>
