<template>
  <div
    class="day"
    :class="{ 'selected': selectedDay === day.id }"
    @click="$emit('selectDay', day.id)"
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
          @click="$emit('toPrevDay', { dayID: day.id, fromIndex: order })"
        >
          {{ '<' }}
        </VButton>
        <VButton
          v-if="isEditor"
          @click="$emit('toNextDay', { dayID: day.id, fromIndex: order })"
        >
          {{ '>' }}
        </VButton>
      </div>

      <div class="buttons">
        <VButton
          v-if="isEditor"
          @click="$emit('removeDay', day.id)"
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
        @remove-task="$emit('removeTask', $event, day.id)"
        @set-task-time="$emit('setTaskTime', { ...$event, dayID: day.id })"
        @set-task-checked="$emit('setTaskChecked', { ...$event, dayID: day.id })"
      />
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import VButton from '../VButton.vue'
import VTask from './VTask.vue'

const props = defineProps({
  day: {
    type: Object,
    required: true
  },
  order: {
    type: Number,
    required: true
  },
  selectedDay: {
    type: String,
    required: true
  },
  isEditor: {
    type: Boolean,
    required: true
  }
})

// const emit = defineEmits(['deleteTask'])

const sortedTasks = computed(() => {
  return props.day.tasks.toSorted((task1, task2) =>
    (task1?.time ? task1?.time.replace(':', '') : 0) -
    (task2?.time ? task2?.time.replace(':', '') : 0))
})

const currentDay = computed(() => {
  const nextDay = props.order * 24 * 60 * 60 * 1000

  const currentDate = new Date(new Date().getTime() + nextDay)
  const day = currentDate.getDate()
  const month = currentDate.getMonth() + 1
  const year = currentDate.getFullYear()
  return day + '/' + month + '/' + year
})
</script>

<style scoped>
.day {
  position: relative;
  display: grid;
  gap: 15px;
  width: 500px;
  padding: 20px;
  border-radius: 10px;
  background: rgba(27, 30, 36, 0.7);

  &.selected {
    background: rgba(0, 0, 0, 0.7);
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
  }

  .list {
    display: grid;
    gap: 10px;
  }
}
</style>
