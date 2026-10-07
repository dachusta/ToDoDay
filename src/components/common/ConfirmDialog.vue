<template>
  <q-dialog
    :model-value="state !== null"
    @update:model-value="onModelValue"
  >
    <q-card
      v-if="state"
      class="confirm-dialog"
      style="min-width: 280px; max-width: 420px"
    >
      <q-card-section class="text-subtitle1 text-weight-medium">
        {{ state.title }}
      </q-card-section>

      <q-card-section class="q-pt-none text-body2">
        {{ state.message }}
      </q-card-section>

      <q-card-actions align="right">
        <q-btn
          flat
          no-caps
          color="grey-8"
          :label="state.cancelLabel ?? t('common.cancel')"
          @click="answer(false)"
        />
        <q-btn
          unelevated
          no-caps
          :color="state.danger ? 'negative' : 'primary'"
          :label="state.confirmLabel ?? t('common.confirm')"
          @click="answer(true)"
        />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useUiStore } from 'src/stores/ui'

/**
 * Хост промис-диалога `uiStore.openConfirm` (контракты §6.2). Один экземпляр
 * монтируется в layout, поэтому подтверждение доступно любому экрану:
 * FR-SET-5 (импорт), FR-SET-10 (очистка), FR-T-6 (удаление из архива).
 * Закрытие по Esc или клику по фону — отказ (resolve(false)).
 */
const ui = useUiStore()
const { t } = useI18n()

const state = computed(() => ui.confirmDialog)

/**
 * Диалог закрывается изнутри (Esc, клик по фону) — это отказ. Событие с
 * value = true здесь не приходит: показ инициируется только через проп
 * `model-value`, а `show()` внутри Quasar не вызывается.
 */
function onModelValue(value: boolean) {
  if (!value) answer(false)
}

function answer(ok: boolean) {
  const current = state.value
  if (current === null) return
  ui.confirmDialog = null
  current.resolve(ok)
}
</script>
