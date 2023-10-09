<script setup>
import { computed } from 'vue'
import VButton from '../VButton.vue'
import VTask from './VTask.vue'
import { useCurrentDay } from '../../composables/currentDay'

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

const { orderDay, currentDay } = useCurrentDay()
orderDay.value = props.order
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
      <div class="progress">
        <span>Прогресс</span>
        <span>0/0</span>
      </div>

      <div class="buttons-move-day">
        <VButton
          v-if="isEditor"
          class="to-prev-day"
          @click="$emit('to-prev-day', { dayId: day._id, fromIndex: order })"
        >
          {{ '➤' }}
        </VButton>
        <VButton
          v-if="isEditor"
          class="to-next-day"
          @click="$emit('to-next-day', { dayId: day._id, fromIndex: order })"
        >
          {{ '➤' }}
        </VButton>
      </div>

      <div class="buttons">
        <VButton
          v-if="isEditor"
          @click="$emit('remove-day', day._id)"
        >
          ✘
        </VButton>
      </div>
    </div>

    <div class="list">
      <VTask
        v-for="task in sortedTasks"
        :key="task"
        :task="task"
        :is-editor="isEditor"
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
      font-size: 24px;
      height: 30px;
    }

    .buttons-move-day {
      display: flex;
      gap: 10px;

      .to-prev-day {
        transform: scale(-1, 1);
      }
    }
  }

  .list {
    display: grid;
    gap: 10px;
  }
}
</style>
