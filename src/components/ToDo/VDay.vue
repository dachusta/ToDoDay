<script setup>
import { computed } from 'vue'
import VButton from '../VButton.vue'
import VTask from './VTask.vue'
import { useCurrentDay } from '../../composables/currentDay'
import IconArrowRight from '../icons/IconArrowRight.vue'
import IconArrowLeft from '../icons/IconArrowLeft.vue'
import IconTrashBin from '../icons/IconTrashBin.vue'

defineEmits([
  'select-day',
  'to-prev-day',
  'to-next-day',
  'remove-day',
  'remove-task',
  'set-task-time',
  'set-task-done'
])

const props = defineProps({
  day: {
    type: Object,
    required: true
  },
  order: {
    type: Number,
    required: true
  },
  selectedDayId: {
    type: String,
    required: true
  },
  isEditor: {
    type: Boolean,
    required: true
  }
})

const sortedTasks = computed(() => {
  return props.day.tasks.toSorted((task1, task2) =>
    (task1?.time ? task1?.time.replace(':', '') : 0) -
    (task2?.time ? task2?.time.replace(':', '') : 0))
})

const countTask = computed(() => {
  return props.day.tasks.length
})

const countTaskDone = computed(() => {
  return props.day.tasks.filter(task => task.checked === true).length
})

const { orderDay, currentDay } = useCurrentDay()
orderDay.value = props.order

const isToDay = computed(() => {
  return orderDay.value === 0
})
</script>

<template>
  <div
    class="day"
    :class="{ 'selected': selectedDayId === day._id }"
    @click="$emit('select-day', day._id)"
  >
    <div class="info">
      <span>{{ currentDay }}</span>
      <!-- <span>Day: 1</span> -->
    </div>

    <div class="header">
      <div
        v-if="isToDay"
        class="progress"
      >
        <span>Прогресс</span>
        <span>{{ countTaskDone }}/{{ countTask }}</span>
      </div>

      <div class="buttons-move-day">
        <VButton
          v-if="isEditor"
          class="to-prev-day"
          icon
          @click="$emit('to-prev-day', { dayId: day._id, fromIndex: order })"
        >
          <IconArrowLeft />
        </VButton>
        <VButton
          v-if="isEditor"
          class="to-next-day"
          icon
          @click="$emit('to-next-day', { dayId: day._id, fromIndex: order })"
        >
          <IconArrowRight />
        </VButton>
      </div>

      <div class="buttons">
        <VButton
          v-if="isEditor"
          icon
          @click="$emit('remove-day', day._id)"
        >
          <IconTrashBin />
        </VButton>
      </div>
    </div>

    <div class="list">
      <VTask
        v-for="task in sortedTasks"
        :key="task"
        :task="task"
        :is-editor="isEditor"
        :is-to-day="isToDay"
        @remove-task="$emit('remove-task', { dayId: day._id, ...$event })"
        @set-task-time="$emit('set-task-time', { dayId: day._id, ...$event })"
        @set-task-done="$emit('set-task-done', { dayId: day._id, ...$event })"
      />
    </div>
  </div>
</template>

<style scoped>
.day {
  position: relative;
  display: grid;
  gap: 15px;
  width: 500px;
  padding: 20px;
  border-radius: 10px;
  background: rgba(27, 30, 36, 0.7);
  /* border: 1px solid transparent; */

  &.selected {
    /* background: rgba(0, 0, 0, 0.7); */
    /* border: 1px solid rgba(27, 30, 36, 0.7); */
    box-shadow:
      0px 0px 30px 0px rgba(53, 178, 122, 0.50),
      inset 0px 0px 10px 0px rgba(53, 178, 122, 0.50);
  }

  .info {
    position: absolute;
    top: -10px;
    padding: 0 20px;
    transform: translateY(-100%);
  }

  .header {
    display: flex;
    justify-content: space-between;
    gap: 20px;
    border-bottom: 1px solid rgba(27, 30, 36, 0.7);
    padding-bottom: 10px;

    .progress {
      display: flex;
      gap: 10px;
      font-size: 24px;
      height: 30px;
    }

    .buttons-move-day {
      display: flex;
      gap: 10px;

      /* .to-prev-day {
        transform: scale(-1, 1);
      } */
    }
  }

  .list {
    display: grid;
    gap: 10px;
  }
}
</style>
