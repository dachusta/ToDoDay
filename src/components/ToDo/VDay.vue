<template>
  <div class="day">
    <div class="info">
      <span>Сегодня / ПН</span>
      <!-- <span>Day: 1</span> -->
    </div>

    <div class="progress">
      <span>Прогресс</span>
      <span>0/0</span>
    </div>

    <div class="list">
      <VTask :key="task" v-for="task in day.tasks" :task="task" />
    </div>
  </div>
</template>

<script setup>
import VTask from './VTask.vue'

defineProps({
  day: {
    type: Object,
    required: true,
  },
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

  .info {
    position: absolute;
    top: -10px;
    padding: 0 20px;
    transform: translateY(-100%);
  }
}
</style>
