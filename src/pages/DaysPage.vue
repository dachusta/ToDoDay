<template>
  <q-page class="days-page q-pa-md">
    <div class="days-page__toolbar row items-center q-col-gutter-sm">
      <div
        class="col text-caption text-grey-7"
        data-test="order-hint"
      >
        {{ t('days.listHint') }}
      </div>
      <div
        class="col-auto text-caption text-grey-7"
        data-test="count"
      >
        {{ t('days.count', { n: plans.plansCount }) }}
      </div>
    </div>

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

    <q-banner
      v-if="plans.hasConflicts"
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
          @click="conflictsOpen = true"
        />
      </template>
    </q-banner>

    <div
      v-if="loading"
      class="days-page__skeleton"
      :aria-label="t('common.loading')"
      data-test="skeleton"
    >
      <div
        v-for="index in 3"
        :key="index"
        class="days-skeleton"
      />
    </div>

    <div
      v-else-if="plans.plansCount === 0"
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
        @click="openCreate()"
      />
    </div>

    <template v-else>
      <section
        v-if="plans.upcomingPlans.length"
        class="days-page__section"
        data-test="upcoming-section"
      >
        <div class="days-page__section-title">
          {{ t('days.upcoming') }}
        </div>
        <div class="days-page__list">
          <DayPlanCard
            v-for="plan in plans.upcomingPlans"
            :key="plan.id"
            :plan="plan"
            :is-today="plan.id === effectiveTodayPlanId"
            @open="openPlan"
            @create-copy="openCopy"
            @delete="onDelete"
          />
        </div>
      </section>

      <section
        v-if="plans.recurringPlans.length"
        class="days-page__section"
        data-test="recurring-section"
      >
        <div class="days-page__section-title">
          {{ t('days.recurringSection') }}
        </div>
        <div class="days-page__list">
          <DayPlanCard
            v-for="plan in plans.recurringPlans"
            :key="plan.id"
            :plan="plan"
            :is-today="plan.id === effectiveTodayPlanId"
            @open="openPlan"
            @create-copy="openCopy"
            @delete="onDelete"
          />
        </div>
      </section>

      <q-expansion-item
        v-if="plans.pastPlans.length"
        class="days-page__section"
        data-test="past-section"
        :label="t('days.pastSection', { n: plans.pastPlans.length })"
      >
        <div class="days-page__list">
          <DayPlanCard
            v-for="plan in plans.pastPlans"
            :key="plan.id"
            :plan="plan"
            :is-past="true"
            @open="openPlan"
            @create-copy="openCopy"
            @delete="onDelete"
          />
        </div>
      </q-expansion-item>

      <q-expansion-item
        v-if="plans.templatePlans.length"
        class="days-page__section"
        data-test="template-section"
        :label="t('days.templatesSection', { n: plans.templatePlans.length })"
      >
        <p class="text-caption text-grey-7">
          {{ t('days.templatesHint') }}
        </p>
        <div class="days-page__list">
          <DayPlanCard
            v-for="plan in plans.templatePlans"
            :key="plan.id"
            :plan="plan"
            @open="openPlan"
            @create-copy="openCopy"
            @delete="onDelete"
          />
        </div>
      </q-expansion-item>
    </template>

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
        @click="openCreate()"
      />
    </q-page-sticky>

    <DayPlanForm
      v-model="formOpen"
      :plan="editing"
      :default-date="defaultDate"
      :base-plan="basePlan"
      @saved="onSaved"
    />

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
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useNow } from '@vueuse/core'
import DayPlanCard from 'src/components/days/DayPlanCard.vue'
import DayPlanForm from 'src/components/days/DayPlanForm.vue'
import { weekdayLabelKey } from 'src/components/days/dayRepeat'
import type { DayPlan } from 'src/models/day'
import { isValidISODate, todayISO } from 'src/services/dates'
import { isOverlapIssue } from 'src/services/validators/day'
import { useCycleStore } from 'src/stores/cycle'
import { useDayPlansStore } from 'src/stores/dayPlans'
import { useUiStore } from 'src/stores/ui'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const plans = useDayPlansStore()
const cycle = useCycleStore()
const ui = useUiStore()

const loadError = ref(false)
const formOpen = ref(false)
const editing = ref<DayPlan | null>(null)
const defaultDate = ref<string | null>(null)
const basePlan = ref<DayPlan | null>(null)
const conflictsOpen = ref(false)
const now = useNow({ interval: 60_000 })

const loading = computed(() => plans.loading && !plans.initialized)

const effectiveTodayPlanId = computed(() => {
  void now.value
  return plans.resolvedPlanForDate(todayISO())?.id ?? null
})

const conflictLines = computed<string[]>(() =>
  plans.recurringPlans.flatMap(plan =>
    plans
      .validateNoOverlap(plan.repeatRule, plan.id)
      .filter(isOverlapIssue)
      .map(issue => lineForIssue(plan.name, issue)),
  ),
)

function lineForIssue(name: string, issue: ReturnType<typeof plans.validateNoOverlap>[number]): string {
  const other = plans.planById(issue.conflictingPlanIds[0] ?? '')?.name ?? t('days.planNotFound')
  const key =
    issue.code === 'OVERLAP_WEEKDAYS'
      ? 'days.validation.overlapWeekdays'
      : 'days.validation.overlapMonthdays'
  const values = (issue.values ?? [])
    .map(value =>
      issue.code === 'OVERLAP_WEEKDAYS' ? t(weekdayLabelKey(value)) : String(value),
    )
    .join(', ')
  const text = t(key, { name: other })
  return values ? `${name}: ${text} — ${t('days.validation.values', { values })}` : `${name}: ${text}`
}

async function load() {
  const result = await plans.loadAll()
  loadError.value = !result.ok
}

function openCreate(date?: string | null) {
  editing.value = null
  basePlan.value = null
  defaultDate.value = date ?? todayISO()
  formOpen.value = true
}

function openCopy(plan: DayPlan) {
  editing.value = null
  basePlan.value = plan
  defaultDate.value = todayISO()
  formOpen.value = true
}

function openPlan(plan: DayPlan) {
  void router.push({ name: 'day-plan', params: { id: plan.id } })
}

async function onSaved(saved: DayPlan) {
  const created = editing.value === null
  editing.value = null
  basePlan.value = null
  defaultDate.value = null
  ui.notify(created ? t('days.created') : t('days.saved'), 'success', undefined, 2000)

  if (!cycle.initialized) return
  if (saved.date === null) return
  if (saved.date === cycle.currentInstance?.date) {
    await cycle.syncCurrentDayWithPlan(saved.id)
  }
}

async function onDelete(plan: DayPlan) {
  const confirmed = await ui.openConfirm({
    title: t('days.deletePlan'),
    message: t('days.deletePlanConfirm', { name: plan.name }),
    confirmLabel: t('common.delete'),
    cancelLabel: t('common.cancel'),
    danger: true,
  })
  if (!confirmed) return

  const result = await plans.deletePlan(plan.id)
  if (result.ok) {
    ui.notify(t('days.deleted'), 'error')
    return
  }
  if (result.error.code === 'CONSTRAINT_VIOLATION') {
    ui.notify(t('days.deletePlanBlocked'), 'warning', undefined, 5000)
    return
  }
  ui.notify(t('days.saveError'), 'error')
}

async function consumeCreateQuery() {
  const create = route.query.create
  if (typeof create !== 'string') return
  const date = isValidISODate(create) ? create : todayISO()
  // Сначала убираем query: QDialog закрывается при смене маршрута, и форма,
  // открытая до router.replace, мгновенно получила бы update:modelValue=false.
  const query = { ...route.query }
  delete query.create
  await router.replace({ query })
  openCreate(date)
}

onMounted(async () => {
  await load()
  await consumeCreateQuery()
})
</script>

<style scoped>
.days-page__section {
  margin-top: 12px;
}

.days-page__section-title {
  margin-bottom: 6px;
  font-size: 13px;
  font-weight: 500;
  color: var(--app-meta);
}

.days-page__list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 6px;
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
  animation: days-skeleton-shimmer 1.2s linear infinite;
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
