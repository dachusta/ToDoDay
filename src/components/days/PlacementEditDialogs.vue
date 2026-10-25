<template>
  <!--
    Диалоги правки размещения: длительность, замена дела и «Переместить в слот…».
    Вынесены с доски, чтобы «Сегодня» и редактор плана пользовались одним
    набором диалогов и одной логикой фокуса (FR-B-7, НФТ §7).
  -->
  <q-dialog v-model="durationOpen">
    <q-card style="min-width: 280px">
      <q-card-section class="text-subtitle1">
        {{ t('placement.durationTitle') }}
      </q-card-section>
      <q-separator />
      <q-card-section class="row items-center justify-center q-gutter-md">
        <q-btn
          round
          dense
          icon="remove"
          :aria-label="t('tasks.decrease')"
          data-test="duration-minus"
          @click="stepDuration(-15)"
        />
        <span
          class="text-h6"
          data-test="duration-value"
        >{{ durationLabel }}</span>
        <q-btn
          round
          dense
          icon="add"
          :aria-label="t('tasks.increase')"
          data-test="duration-plus"
          @click="stepDuration(15)"
        />
      </q-card-section>
      <q-separator />
      <q-card-actions align="right">
        <q-btn
          v-close-popup
          flat
          no-caps
          :label="t('common.cancel')"
        />
        <q-btn
          unelevated
          no-caps
          color="primary"
          :label="t('common.save')"
          data-test="duration-save"
          @click="saveDuration"
        />
      </q-card-actions>
    </q-card>
  </q-dialog>

  <q-dialog v-model="replaceOpen">
    <q-card style="min-width: 320px; max-width: 460px">
      <q-card-section class="text-subtitle1">
        {{ t('placement.replaceTitle') }}
      </q-card-section>
      <q-separator />
      <q-card-section class="placement-dialogs__picker">
        <p
          v-if="replaceCandidates.length === 0"
          class="text-grey-7"
          data-test="replace-empty"
        >
          {{ t('placement.noTasks') }}
        </p>
        <q-list v-else>
          <q-item
            v-for="task in replaceCandidates"
            :key="task.id"
            v-close-popup
            clickable
            :data-test="`replace-${task.id}`"
            @click="applyReplace(task.id)"
          >
            <q-item-section avatar>
              <span
                class="placement-dialogs__swatch"
                :style="{ backgroundColor: task.color }"
              />
            </q-item-section>
            <q-item-section>{{ task.title }}</q-item-section>
            <q-item-section side>
              <PriorityBadge :priority="task.priority" />
            </q-item-section>
          </q-item>
        </q-list>
      </q-card-section>
      <q-separator />
      <q-card-actions align="right">
        <q-btn
          v-close-popup
          flat
          no-caps
          :label="t('common.cancel')"
        />
      </q-card-actions>
    </q-card>
  </q-dialog>

  <q-dialog
    v-model="slotPickerOpen"
    @show="focusFirstSlot"
  >
    <q-card style="min-width: 280px; max-width: 420px">
      <q-card-section class="text-subtitle1">
        {{ t('placement.moveToSlotTitle') }}
      </q-card-section>
      <q-separator />
      <div
        ref="slotListEl"
        class="placement-dialogs__slots"
        role="list"
        :aria-label="t('placement.slotListAria')"
        data-test="slot-list"
        @keydown="onSlotListKeydown"
      >
        <div
          v-for="slot in slots"
          :key="slot.index"
          class="placement-dialogs__slot"
          role="listitem"
          tabindex="0"
          :aria-label="slotLabel(slot)"
          :data-test="`slot-${slot.index}`"
          @click="applyMove(slot)"
          @keydown.enter.prevent="applyMove(slot)"
          @keydown.space.prevent="applyMove(slot)"
        >
          {{ slotLabel(slot) }}
        </div>
      </div>
      <q-separator />
      <q-card-actions align="right">
        <q-btn
          v-close-popup
          flat
          no-caps
          :label="t('common.cancel')"
        />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import PriorityBadge from 'src/components/common/PriorityBadge.vue'
import { durationDescriptor } from 'src/components/tasks/taskFormat'
import { formatClock } from 'src/services/dates'
import type { Slot } from 'src/models/cycle'
import type { Placement } from 'src/models/dayInstance'
import type { TimeFormat } from 'src/models/enums'
import { useTasksStore } from 'src/stores/tasks'

const props = withDefaults(
  defineProps<{
    slots: Slot[]
    timeFormat?: TimeFormat
    dayStartMin?: number
  }>(),
  { timeFormat: '24h', dayStartMin: 0 },
)

const emit = defineEmits<{
  'change-duration': [placementId: string, durationMin: number]
  replace: [placementId: string, taskId: string]
  'move-to-slot': [placementId: string, slot: Slot]
}>()

const { t } = useI18n()
const tasks = useTasksStore()

const durationOpen = ref(false)
const durationDraft = ref(15)
const replaceOpen = ref(false)
const slotPickerOpen = ref(false)
const activePlacementId = ref<string | null>(null)
const slotListEl = ref<HTMLElement | null>(null)

const replaceCandidates = computed(() =>
  [...tasks.activeTasks].sort((a, b) => a.title.localeCompare(b.title)),
)

const durationLabel = computed(() => {
  const { key, params } = durationDescriptor(durationDraft.value)
  return t(key, params)
})

function slotLabel(slot: Slot): string {
  return formatClock(slot.label, props.timeFormat)
}

function openDuration(placement: Placement): void {
  activePlacementId.value = placement.id
  durationDraft.value = placement.durationMin
  durationOpen.value = true
}

function openReplace(placement: Placement): void {
  activePlacementId.value = placement.id
  replaceOpen.value = true
}

function openSlotPicker(placement: Placement): void {
  activePlacementId.value = placement.id
  slotPickerOpen.value = true
}

function stepDuration(delta: number) {
  durationDraft.value = Math.min(1425, Math.max(15, durationDraft.value + delta))
}

function saveDuration() {
  const id = activePlacementId.value
  durationOpen.value = false
  if (id) emit('change-duration', id, durationDraft.value)
}

function applyReplace(taskId: string) {
  const id = activePlacementId.value
  replaceOpen.value = false
  if (id) emit('replace', id, taskId)
}

function applyMove(slot: Slot) {
  const id = activePlacementId.value
  slotPickerOpen.value = false
  if (id) emit('move-to-slot', id, slot)
}

function slotItems(): HTMLElement[] {
  return [...(slotListEl.value?.querySelectorAll<HTMLElement>('[role="listitem"]') ?? [])]
}

function focusFirstSlot() {
  slotItems()[0]?.focus()
}

watch(slotPickerOpen, open => {
  if (!open) return
  void nextTick(() => {
    focusFirstSlot()
    setTimeout(focusFirstSlot, 0)
  })
})

function onSlotListKeydown(event: KeyboardEvent) {
  const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End']
  if (!keys.includes(event.key)) return
  event.preventDefault()

  const items = slotItems()
  if (items.length === 0) return
  const current = items.findIndex(item => item === document.activeElement)
  const next =
    event.key === 'ArrowDown'
      ? current + 1
      : event.key === 'ArrowUp'
        ? current - 1
        : event.key === 'Home'
          ? 0
          : items.length - 1
  items[Math.min(Math.max(next, 0), items.length - 1)]?.focus()
}

defineExpose({ openDuration, openReplace, openSlotPicker })
</script>

<style scoped>
.placement-dialogs__picker {
  max-height: 50vh;
  overflow-y: auto;
}

.placement-dialogs__swatch {
  display: inline-block;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.15);
}

.placement-dialogs__slots {
  max-height: 50vh;
  overflow-y: auto;
}

.placement-dialogs__slot {
  padding: 4px 12px;
  font-size: 13px;
  cursor: pointer;
}

.placement-dialogs__slot:focus-visible,
.placement-dialogs__slot:hover {
  background: rgba(25, 118, 210, 0.12);
  outline: none;
}
</style>
