<template>
  <!--
    Карточка шаблона дня (вайрфреймы §3.1): ручка ⠿, номер в цикле, название с
    акцентным цветом, диапазон времени, человекочитаемое правило и число
    подготовленных дел (FR-D-7). «Часы занято» не показываются: размещений у
    шаблона нет, они появляются только в экземпляре дня.
  -->
  <div
    class="day-template-card"
    :class="{
      'day-template-card--dragging': dragging,
      'day-template-card--drop-target': dropTarget,
    }"
  >
    <span
      class="day-template-card__handle"
      :title="t('days.dragAria', { name: template.name })"
      aria-hidden="true"
      @pointerdown="emit('handle-down', $event)"
    >⠿</span>

    <span
      class="day-template-card__order"
      data-test="order"
    >{{ position }}</span>

    <div class="day-template-card__body">
      <div class="day-template-card__head">
        <span
          class="day-template-card__accent"
          :style="{ backgroundColor: template.accentColor }"
          aria-hidden="true"
        />
        <span
          class="day-template-card__name"
          :title="template.name"
        >{{ template.name }}</span>
      </div>
      <div class="day-template-card__meta">
        <span class="day-template-card__time">{{ timeRange }}</span>
        <span aria-hidden="true">·</span>
        <span
          class="day-template-card__rule"
          data-test="rule"
        >{{ ruleText }}</span>
        <span aria-hidden="true">·</span>
        <span
          class="day-template-card__tasks"
          data-test="tasks-count"
        >{{ t('days.tasksCount', { n: template.plannedTaskIds?.length ?? 0 }) }}</span>
      </div>
    </div>

    <div class="day-template-card__actions">
      <!--
        Клавиатурная альтернатива drag-and-drop (НФТ ТЗ §7): порядок в цикле
        меняется и без перетаскивания — стрелками, доступными с клавиатуры.
      -->
      <q-btn
        flat
        dense
        round
        size="sm"
        icon="arrow_upward"
        :disable="!canMoveUp"
        :aria-label="t('days.moveUp')"
        data-test="move-up"
        @click="emit('move', -1)"
      >
        <q-tooltip>{{ t('days.moveUp') }}</q-tooltip>
      </q-btn>
      <q-btn
        flat
        dense
        round
        size="sm"
        icon="arrow_downward"
        :disable="!canMoveDown"
        :aria-label="t('days.moveDown')"
        data-test="move-down"
        @click="emit('move', 1)"
      >
        <q-tooltip>{{ t('days.moveDown') }}</q-tooltip>
      </q-btn>

      <q-btn
        flat
        dense
        round
        icon="more_vert"
        :aria-label="t('days.menuAria', { name: template.name })"
        data-test="menu"
      >
        <q-menu
          anchor="bottom right"
          self="top right"
        >
          <q-list style="min-width: 220px">
            <q-item
              v-close-popup
              clickable
              data-action="edit"
              @click="emit('action', 'edit')"
            >
              <q-item-section avatar>
                <q-icon name="edit" />
              </q-item-section>
              <q-item-section>{{ t('days.edit') }}</q-item-section>
            </q-item>
            <q-item
              v-close-popup
              clickable
              data-action="tasks"
              @click="emit('action', 'tasks')"
            >
              <q-item-section avatar>
                <q-icon name="checklist" />
              </q-item-section>
              <q-item-section>{{ t('days.editTasks') }}</q-item-section>
            </q-item>
            <q-separator />
            <q-item
              v-close-popup
              clickable
              class="text-negative"
              data-action="delete"
              @click="emit('action', 'delete')"
            >
              <q-item-section avatar>
                <q-icon name="delete" />
              </q-item-section>
              <q-item-section>{{ t('days.delete') }}</q-item-section>
            </q-item>
          </q-list>
        </q-menu>
      </q-btn>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { DayTemplate } from 'src/models/day'
import { weekdayListText } from './dayRepeat'

const props = defineProps<{
  template: DayTemplate
  /** Номер на карточке — `order + 1` (вайрфреймы §3.1). */
  position: number
  /** Перестановка стрелками: у первой карточки «выше» недоступно. */
  canMoveUp: boolean
  canMoveDown: boolean
  /** Карточку сейчас тащат: активная полупрозрачна (вайрфреймы §3.2). */
  dragging: boolean
  /** Сюда встанет перетаскиваемая карточка: прицел между карточками (§3.2). */
  dropTarget: boolean
}>()

const emit = defineEmits<{
  /** 'tasks' — быстрое редактирование списка дел (FR-D-7). */
  action: [id: 'edit' | 'tasks' | 'delete']
  /** Сдвиг в цикле на delta позиций: -1 вверх, +1 вниз. */
  move: [delta: number]
  /** Нажатие на ручку ⠿: начало перетаскивания (pointer events, ТЗ §4.1). */
  'handle-down': [event: PointerEvent]
}>()

const { t } = useI18n()

/**
 * Состояния перетаскивания (вайрфреймы §3.2): `--dragging` — активная карточка,
 * `--drop-target` — прицел на месте вставки. Классы считает страница (она ведёт
 * перетаскивание на pointer events), карточка только рисует их.
 */
const timeRange = computed(() => `${props.template.timeStart}–${props.template.timeEnd}`)

/** Правило словами: «Пн, Вт, Ср», «1, 15 числа» либо «без привязки» (FR-D-1). */
const ruleText = computed(() => {
  const rule = props.template.repeatRule
  if (rule.type === 'weekdays') {
    const list = weekdayListText(rule.weekdays ?? [], key => t(key))
    return list === '' ? t('days.ruleNone') : list
  }
  if (rule.type === 'monthdays') {
    const list = (rule.monthdays ?? []).join(', ')
    return list === '' ? t('days.ruleNone') : t('days.ruleMonthdays', { list })
  }
  return t('days.ruleNone')
})
</script>

<style scoped>
.day-template-card {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 4px 10px 8px;
  border: 1px solid var(--q-separator-color, var(--app-separator));
  border-radius: 8px;
  background: var(--q-card-background, var(--app-surface));
}

/*
  Перенос (FR-D-2): признак — пунктир и тень, а не `opacity`. Прозрачность всей
  карточки уронила бы контраст названия и правила ниже WCAG AA (НФТ ТЗ §7).
*/
.day-template-card--dragging {
  border-style: dashed;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.24);
}

/* Прицел между карточками: линия над карточкой — местом вставки (вайрфреймы §3.2). */
.day-template-card--drop-target {
  box-shadow: 0 -3px 0 0 var(--q-primary, #1976d2);
}

/* Ручка перетаскивания — не текст, ей достаточно 3:1 как графическому элементу
   (WCAG 1.4.11); #757575 даёт 4.61:1 на белом и остаётся видимой в тёмной теме */
.day-template-card__handle {
  cursor: grab;
  color: var(--app-hint);
  user-select: none;
  /* Перетаскивание за ручку не должно прокручивать список на тач-экране. */
  touch-action: none;
}

.day-template-card__order {
  min-width: 16px;
  text-align: right;
  color: var(--app-meta);
  font-variant-numeric: tabular-nums;
}

.day-template-card__body {
  flex: 1 1 auto;
  min-width: 0;
}

.day-template-card__head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.day-template-card__accent {
  flex: 0 0 10px;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.12);
}

.day-template-card__name {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 500;
}

.day-template-card__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  line-height: 18px;
  color: var(--app-meta);
}

.day-template-card__time,
.day-template-card__rule {
  font-variant-numeric: tabular-nums;
}

.day-template-card__actions {
  display: flex;
  align-items: center;
  flex: 0 0 auto;
  padding-right: 4px;
}
</style>
