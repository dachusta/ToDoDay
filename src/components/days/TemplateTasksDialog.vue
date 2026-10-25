<template>
  <!--
    Быстрое редактирование списка дел шаблона с экрана «Дни» (FR-D-7). Полная
    форма шаблона для этого не нужна: меняется только plannedTaskIds, остальные
    поля проверяются по уже сохранённому шаблону.
  -->
  <q-dialog
    :model-value="modelValue"
    :maximized="$q.screen.lt.sm"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <q-card
      class="template-tasks-dialog"
      style="width: 520px; max-width: 100%"
    >
      <q-card-section class="text-subtitle1">
        {{ t('days.tasksDialogTitle', { name: template?.name ?? '' }) }}
      </q-card-section>

      <q-separator />

      <q-card-section class="template-tasks-dialog__body">
        <TemplateTaskList v-model="draft" />

        <div
          v-if="hasTaskIssue"
          class="text-negative text-caption q-mt-sm"
          role="alert"
          data-test="tasks-error"
        >
          {{ t('days.validation.taskMissing') }}
        </div>
      </q-card-section>

      <q-separator />

      <q-card-actions align="right">
        <q-btn
          flat
          no-caps
          :label="t('common.cancel')"
          @click="close"
        />
        <q-btn
          unelevated
          no-caps
          color="primary"
          :label="t('common.save')"
          :loading="saving"
          data-test="tasks-save"
          @click="save"
        />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useQuasar } from 'quasar'
import { useI18n } from 'vue-i18n'
import TemplateTaskList from './TemplateTaskList.vue'
import type { DayTemplate, ValidationIssue } from 'src/models/day'
import { normalizePlannedTaskIds } from 'src/services/templateTasks'
import { useDaysStore } from 'src/stores/days'
import { useUiStore } from 'src/stores/ui'

const props = defineProps<{
  /** Открыт ли диалог. */
  modelValue: boolean
  /** Шаблон, чей список дел правится; null — диалог не открывается. */
  template: DayTemplate | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  saved: [template: DayTemplate]
}>()

const { t } = useI18n()
const $q = useQuasar()
const days = useDaysStore()
const ui = useUiStore()

const draft = ref<string[]>([])
const issues = ref<ValidationIssue[]>([])
const saving = ref(false)

const hasTaskIssue = computed(() =>
  issues.value.some(issue => issue.code === 'TASK_NOT_FOUND'),
)

watch(
  () => [props.modelValue, props.template] as const,
  ([open]) => {
    if (!open) return
    draft.value = normalizePlannedTaskIds(props.template?.plannedTaskIds ?? [])
    issues.value = []
  },
  { immediate: true },
)

function close(): void {
  emit('update:modelValue', false)
}

async function save(): Promise<void> {
  const template = props.template
  if (!template || saving.value) return

  saving.value = true
  try {
    const result = await days.updateTemplate(template.id, { plannedTaskIds: [...draft.value] })
    if (!result.ok) {
      issues.value = [...days.lastValidationErrors]
      // Ссылки на отсутствующие дела показываются инлайн; остальное — тост.
      if (result.error.code === 'VALIDATION_ERROR') return
      ui.notify(t('days.saveError'), 'error')
      return
    }

    emit('saved', result.data)
    close()
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.template-tasks-dialog__body {
  max-height: 70vh;
  overflow-y: auto;
}
</style>
