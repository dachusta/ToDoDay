<script setup>
import ToDoTask from './ToDoTask.vue'

defineProps({
  day: {
    type: Object,
    required: true
  }
})

// const emit = defineEmits(['setTask'])
function setTask (day) {
  // emit('setTask', day)

  day.value.push({
    time: '',
    value: ''
  })
}
</script>

<template>
  <div class="day">
    <header>Сегодня / Пн | Day: {{ day.order }}</header>
    <main>
      <div>
        <ToDoTask
          v-for="task in day.value"
          :key="task.value.time"
          :task="task"
          class="task"
          @deleteTask="$emit('deleteTask', $event)"
        />
      </div>
    </main>
    <footer>
      <button
        class="button__set-task"
        @click="setTask(day)"
      >
        +
      </button>
    </footer>
  </div>
</template>

<style lang="scss" scoped>
.day {
  padding: 5px;
  background: rgba(0, 0, 0, 0.5);
}
.button__set-task {
}
</style>
