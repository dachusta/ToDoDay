<template>
  <div class="day">
    <div class="info">
      <span>{{ currentDay }}</span>
      <!-- <span>Day: 1</span> -->
    </div>

    <div
      v-if="day"
      class="list"
    >
      <VTask
        v-for="task in day.tasks"
        :key="task"
        :task="task"
      />
    </div>
    <div
      v-else
      class="else"
    >
      Чтобы создать день перейдите в режим редактора
    </div>
  </div>
</template>

<script setup>
import VTask from './VTask.vue'
import { useCurrentDay } from '../../composables/currentDay'

const props = defineProps({
  day: {
    type: Object,
    required: true
  },
  order: {
    type: Number,
    required: true
  }
})

const { orderDay, currentDay } = useCurrentDay()
orderDay.value = props.order
</script>

<style scoped>
.day {
  position: relative;
  display: grid;
  justify-content: center;
  align-items: center;
  gap: 15px;
  width: 500px;
  height: 500px;
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
