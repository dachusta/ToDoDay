<template>
  <q-page class="days-page q-pa-md">
    <!--
      Экран «Дни» (вайрфреймы §3): список шаблонов с drag-сортировкой (FR-D-2),
      счётчиком и режимом сортировки, состояния загрузки/пустоты/ошибки, FAB и
      форма шаблона (FR-D-1, FR-D-3). Конфликты правил показываются баннером со
      ссылкой на перечень (FR-D-5, вайрфреймы §3.2).
    -->
    <div class="days-page__toolbar row items-center q-col-gutter-sm">
      <div
        class="col text-caption text-grey-7"
        data-test="order-hint"
      >
        {{ t('days.orderHint') }}
      </div>
      <div
        class="col-auto text-caption text-grey-7"
        data-test="count"
      >
        {{ t('days.count', { n: days.templatesCount }) }}
      </div>
      <div class="col-auto">
        <q-select
          v-model="sortMode"
          :options="sortOptions"
          emit-value
          map-options
          dense
          outlined
          class="days-page__sort"
          :label="t('days.sort')"
          data-test="sort-mode"
        />
      </div>
    </div>

    <!-- Ошибка БД: баннер с повтором, данные не изменены (вайрфреймы §3.2). -->
    <q-banner
      v-if="loadError"
      dense
      class="bg-negative text-white q-mb-sm"
      data-test="load-error"
    >
      {{ t('days.loadError') }}
      <template #action>
        <q-btn
          flat
          no-caps
          color="white"
          :label="t('common.retry')"
          @click="load"
        />
      </template>
    </q-banner>

    <!-- Конфликты уже сохранённых правил (например, после импорта FR-SET-5). -->
    <q-banner
      v-if="days.hasConflicts"
      dense
      class="bg-warning text-black q-mb-sm"
      data-test="conflict-banner"
    >
      {{ t('days.conflictBanner') }}
      <template #action>
        <q-btn
          flat
          no-caps
          color="black"
          :label="t('days.showConflicts')"
          data-test="show-conflicts"
          @click="openStoredConflicts"
        />
      </template>
    </q-banner>

    <div
      v-if="loading"
      class="days-page__skeleton"
      :aria-label="t('common.loading')"
    >
      <div
        v-for="index in 3"
        :key="index"
        class="days-skeleton"
      />
    </div>

    <div
      v-else-if="days.templatesCount === 0"
      class="days-page__empty"
      data-test="empty"
    >
      <q-icon
        name="calendar_today"
        size="40px"
        class="text-grey-6"
      />
      <div class="text-subtitle1">
        {{ t('days.empty') }}
      </div>
      <div class="text-body2 text-grey-7">
        {{ t('days.emptyHint') }}
      </div>
      <q-btn
        unelevated
        no-caps
        color="primary"
        icon="add"
        :label="t('days.new')"
        class="q-mt-sm"
        data-test="empty-create"
        @click="openCreate"
      />
    </div>

    <!--
      Порядок в цикле: перетаскивание за ручку ⠿ (pointer events) пересчитывает
      order через daysStore.moveToPosition (FR-D-2, контракты §2.6). В режиме «по
      названию» перетаскивание выключено: список показывает не порядок цикла, и
      drag переставлял бы шаблоны «наугад».
    -->
    <div
      v-else
      ref="listEl"
      class="days-page__list"
      data-test="list"
    >
      <DayTemplateCard
        v-for="(element, index) in list"
        :key="element.id"
        :template="element"
        :position="index + 1"
        :can-move-up="draggableOrder && index > 0"
        :can-move-down="draggableOrder && index < list.length - 1"
        :dragging="draggingIndex === index"
        :drop-target="dropIndex === index && draggingIndex !== null && draggingIndex !== index"
        @action="id => onAction(id, element)"
        @move="delta => move(element, delta)"
        @handle-down="event => onHandleDown(event, index)"
      />
    </div>

    <q-page-sticky
      position="bottom-right"
      :offset="[18, 18]"
    >
      <q-btn
        fab
        color="primary"
        icon="add"
        :label="t('days.fab')"
        :aria-label="t('days.new')"
        data-test="new-day"
        @click="openCreate"
      />
    </q-page-sticky>

    <DayTemplateForm
      v-model="formOpen"
      :template="editing"
      @saved="onSaved"
      @conflict="onConflict"
    />

    <!-- Диалог с перечнем конфликтующих шаблонов (FR-D-5, вайрфреймы §3.2). -->
    <q-dialog v-model="conflictsOpen">
      <q-card style="width: 480px; max-width: 100%">
        <q-card-section class="text-subtitle1">
          {{ t('days.conflictsTitle') }}
        </q-card-section>
        <q-separator />
        <q-card-section class="days-page__conflicts">
          <div
            v-if="conflictLines.length === 0"
            class="text-grey-7"
            data-test="conflicts-none"
          >
            {{ t('days.conflictNone') }}
          </div>
          <div
            v-for="(line, index) in conflictLines"
            :key="index"
            class="q-mb-xs"
            data-test="conflict-row"
          >
            {{ line }}
          </div>
          <div class="text-caption text-grey-7 q-mt-sm">
            {{ t('days.conflictsHint') }}
          </div>
        </q-card-section>
        <q-separator />
        <q-card-actions align="right">
          <q-btn
            v-close-popup
            flat
            no-caps
            :label="t('common.close')"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </q-page>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import DayTemplateCard from 'src/components/days/DayTemplateCard.vue'
import DayTemplateForm from 'src/components/days/DayTemplateForm.vue'
import { weekdayLabelKey } from 'src/components/days/dayRepeat'
import type { DayTemplate, RepeatRule } from 'src/models/day'
import { isOverlapIssue } from 'src/services/validators/day'
import { useDaysStore } from 'src/stores/days'
import { useCycleStore } from 'src/stores/cycle'
import { useUiStore } from 'src/stores/ui'

const { t } = useI18n()
const days = useDaysStore()
const cycle = useCycleStore()
const ui = useUiStore()

const loadError = ref(false)
const formOpen = ref(false)
const editing = ref<DayTemplate | null>(null)
const conflictsOpen = ref(false)
/**
 * Правило, конфликты которого показывает диалог: его присылает форма при
 * отклонённом сохранении (FR-D-5). null — диалог открыт из баннера и показывает
 * пересечения уже сохранённых шаблонов (например, после импорта, FR-SET-5).
 */
const conflictRule = ref<RepeatRule | null>(null)

/** Локальная копия списка для перетаскивания: drag не мутирует state стора. */
const list = ref<DayTemplate[]>([])

/** Корень списка: по нему считаются середины карточек при перетаскивании. */
const listEl = ref<HTMLElement | null>(null)
const draggingIndex = ref<number | null>(null)
const dropIndex = ref<number | null>(null)

const sortMode = computed<'manual' | 'name'>({
  get: () => days.sortMode,
  set: value => days.setSortMode(value),
})

const sortOptions = computed(() => [
  { label: t('days.sortManual'), value: 'manual' },
  { label: t('days.sortName'), value: 'name' },
])

/** Перетаскивание имеет смысл только в режиме «по порядку» (контракты §2.6). */
const draggableOrder = computed(() => days.sortMode === 'manual')

/** Пока идёт первичная загрузка — skeleton вместо пустого состояния. */
const loading = computed(() => days.loading && !days.initialized)

/**
 * Список для vuedraggable: копия показываемого порядка (manual — по `order`,
 * name — по названию, контракты §2.2). В режиме «по названию» порядок цикла не
 * показывается, поэтому и перестановка выключена: стрелки и drag доступны только
 * там, где список отражает `order`.
 */
watch(
  () => days.sortedTemplates,
  value => {
    list.value = [...value]
  },
  { immediate: true },
)

onMounted(() => {
  void load()
})

// Контракты §2.3: подписка живёт, пока экран открыт. Перетаскивание снимает
// свои слушатели с window, иначе они пережили бы переход на другой экран.
onUnmounted(() => {
  stopDrag()
  days.unsubscribe()
})

/** Загрузка шаблонов. Ошибка БД — баннер, а не пустой экран. */
async function load() {
  const result = await days.loadAll()
  loadError.value = !result.ok
}

function openCreate() {
  editing.value = null
  formOpen.value = true
}

/**
 * FR-D-6 / ТЗ §6 правило 7а: после создания или правки шаблона пустой
 * (виртуальный) текущий день заменяется днём по шаблону. force пересчитывает
 * только виртуальный день — материализованный экземпляр не пересоздаётся
 * (FR-D-3), поэтому вызов безвреден и для правки.
 */
async function onSaved() {
  const created = editing.value === null
  editing.value = null
  conflictRule.value = null
  ui.notify(created ? t('days.created') : t('days.saved'), 'success', undefined, 2000)

  if (!cycle.initialized || !cycle.isVirtualInstance) return
  await cycle.resolveCurrentDay({ force: true })
}

/**
 * Конфликт правил (FR-D-5): форма уже показала перечень инлайн, страница
 * добавляет снэкбар со ссылкой на диалог (вайрфреймы §3.2). В диалог уходит
 * правило отклонённого сохранения — иначе «Показать конфликты» открыло бы
 * пересечения сохранённых шаблонов, а не то, что пользователь только что ввёл.
 */
function onConflict(rule: RepeatRule) {
  conflictRule.value = rule
  ui.notify(t('days.conflictBanner'), 'warning', {
    label: t('days.showConflicts'),
    handler: () => {
      conflictsOpen.value = true
    },
  })
}

/** Диалог из баннера: показываем пересечения уже сохранённых шаблонов. */
function openStoredConflicts() {
  conflictRule.value = null
  conflictsOpen.value = true
}

async function onAction(id: 'edit' | 'delete', template: DayTemplate) {
  if (id === 'edit') {
    editing.value = template
    formOpen.value = true
    return
  }

  const confirmed = await ui.openConfirm({
    title: t('days.delete'),
    message: t('days.deleteConfirm', { name: template.name }),
    confirmLabel: t('common.delete'),
    cancelLabel: t('common.cancel'),
    danger: true,
  })
  if (!confirmed) return

  const result = await days.deleteTemplate(template.id)
  if (result.ok) {
    ui.notify(t('days.deleted'), 'error')
    return
  }
  // FR-D-4: шаблон держит незавершённый день — удаление запрещено, предлагаем
  // сначала завершить день. Это не ошибка БД, повторять операцию бессмысленно.
  if (result.error.code === 'CONSTRAINT_VIOLATION') {
    ui.notify(t('days.deleteBlocked'), 'warning', undefined, 5000)
    return
  }
  ui.notify(t('days.saveError'), 'error')
}

/** Перестановка стрелками — клавиатурная альтернатива drag (НФТ ТЗ §7). */
async function move(template: DayTemplate, delta: number) {
  // Стрелки доступны только в режиме «по порядку», поэтому индекс в показываемом
  // списке совпадает с индексом в order.
  const ordered = days.orderedTemplates
  const from = ordered.findIndex(item => item.id === template.id)
  const to = from + delta
  if (from < 0 || to < 0 || to >= ordered.length) return

  const result = await days.moveToPosition(template.id, to)
  if (!result.ok) {
    ui.notify(t('days.saveError'), 'error')
    return
  }
  list.value = [...days.sortedTemplates]
}

/**
 * Перетаскивание за ручку ⠿ — на pointer events (тот же приём, что ТЗ §4.1
 * предписывает доске дня). Своя реализация вместо vuedraggable сознательно:
 * библиотека объявлена через Options API, а Quasar собирает приложение с
 * `build.vueOptionsAPI: false` (по умолчанию) — тогда Vue не вызывает
 * applyOptions, у vuedraggable не регистрируются computed realList/getKey, её
 * render не рисует ничего, и список остаётся пустым при непустом счётчике
 * (журнал, приложение С, дефект D15).
 */
function onHandleDown(event: PointerEvent, index: number): void {
  if (!draggableOrder.value) return
  draggingIndex.value = index
  dropIndex.value = index
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
  window.addEventListener('pointercancel', onPointerUp)
  event.preventDefault()
}

/** Карточки списка в порядке разметки: по ним считается место вставки. */
function cardElements(): HTMLElement[] {
  return [...(listEl.value?.querySelectorAll<HTMLElement>('.day-template-card') ?? [])]
}

/** Место вставки: первая карточка, чья середина ниже указателя. */
function onPointerMove(event: PointerEvent): void {
  if (draggingIndex.value === null) return
  const cards = cardElements()
  if (!cards.length) return

  let target = cards.length - 1
  for (let index = 0; index < cards.length; index += 1) {
    const rect = cards[index]?.getBoundingClientRect()
    if (rect && event.clientY < rect.top + rect.height / 2) {
      target = index
      break
    }
  }
  dropIndex.value = target
}

async function onPointerUp(): Promise<void> {
  const from = draggingIndex.value
  const to = dropIndex.value
  stopDrag()
  if (from === null || to === null || from === to) return

  const moved = list.value[from]
  if (!moved) return

  const result = await days.moveToPosition(moved.id, to)
  if (!result.ok) {
    ui.notify(t('days.saveError'), 'error')
    return
  }
  list.value = [...days.sortedTemplates]
}

function stopDrag(): void {
  draggingIndex.value = null
  dropIndex.value = null
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
  window.removeEventListener('pointercancel', onPointerUp)
}

/**
 * Перечень конфликтов для диалога (FR-D-5, вайрфреймы §3.2): строка на каждое
 * пересечение — с кем именно и по каким значениям. Считается теми же функциями,
 * что и валидация формы (`days.validateNoOverlap` → `repeat.validateNoOverlap`),
 * поэтому «Показать конфликты» из снэкбара показывает ровно то, что отклонено.
 */
const conflictLines = computed<string[]>(() => {
  const draft = conflictRule.value
  if (draft) return linesForRule(draft)
  return days.orderedTemplates.flatMap(template =>
    linesForRule(template.repeatRule, template.id).map(line => `${template.name}: ${line}`),
  )
})

function linesForRule(rule: RepeatRule, excludeId?: string): string[] {
  return days
    .validateNoOverlap(rule, excludeId)
    .filter(isOverlapIssue)
    .map(issue => {
      const name =
        days.templateById(issue.conflictingTemplateIds[0] ?? '')?.name ??
        t('day.templateDeleted')
      const key =
        issue.code === 'OVERLAP_WEEKDAYS'
          ? 'days.validation.overlapWeekdays'
          : 'days.validation.overlapMonthdays'
      const values = (issue.values ?? [])
        .map(value =>
          issue.code === 'OVERLAP_WEEKDAYS' ? t(weekdayLabelKey(value)) : String(value),
        )
        .join(', ')
      const text = t(key, { name })
      return values ? `${text} — ${t('days.validation.values', { values })}` : text
    })
}
</script>

<style scoped>
.days-page__sort {
  min-width: 150px;
}

.days-page__list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.days-page__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 32px 16px;
  text-align: center;
}

.days-page__skeleton {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.days-skeleton {
  height: 56px;
  border-radius: 8px;
  background: linear-gradient(90deg, #eeeeee 25%, #f5f5f5 50%, #eeeeee 75%);
  background-size: 200% 100%;
  animation: days-skeleton-shimmer 1.2s infinite linear;
}

.days-page__conflicts {
  max-height: 60vh;
  overflow-y: auto;
}

@keyframes days-skeleton-shimmer {
  from {
    background-position: 200% 0;
  }

  to {
    background-position: -200% 0;
  }
}
</style>
