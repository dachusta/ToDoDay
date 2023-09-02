<template>
  <div
    class="day"
    :class="{ 'selected': selectedDay === day.id }"
    @click="$emit('selectDay', day.id)"
  >
    <div class="info">
      <span>Сегодня / ПН</span>
      <!-- <span>Day: 1</span> -->
    </div>

    <div class="header">
      <div class="progress">
        <span>Прогресс</span>
        <span>0/0</span>
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
        v-for="task in day.tasks"
        :key="task"
        :task="task"
        :is-editor="isEditor"
        @remove-task="$emit('removeTask', $event, day.id)"
        @set-task-time="$emit('setTaskTime', { ...$event, dayID: day.id })"
      />
    </div>
  </div>
</template>

<script setup>
import VButton from '../VButton.vue'
import VTask from './VTask.vue'

defineProps({
  day: {
    type: Object,
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
