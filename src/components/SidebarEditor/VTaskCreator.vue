<script setup>
import { ref } from 'vue'
import IconCheckMark from '../icons/IconCheckMark.vue'
defineEmits(['create-task'])

const newTask = ref({
  priority: 0,
  value: '',
  color: ''
})
</script>

<template>
  <div class="task-creator">
    <input
      v-model="newTask.priority"
      type="number"
      class="priority"
      min="0"
      max="3"
    >
    <input
      v-model="newTask.value"
      type="text"
      class="value"
    >
    <input
      v-model="newTask.color"
      type="color"
      class="color"
    >
    <button
      class="button"
      @click="$emit('create-task', newTask)"
    >
      <IconCheckMark />
    </button>
  </div>
</template>

<style scoped>
.task-creator {
  display: flex;
  background: rgba(27, 30, 36, 0.5);
  /* padding: 2px 4px; */
  border: 1px solid #ffffff;
  border-radius: 5px;
  color: #FFFFFF;

  .priority {
    width: 50px;
    background: transparent;
    color: inherit;
    padding: 6px 10px;
    border: none;
    border-right: 1px solid #FFFFFF;
  }
  .value {
    width: 100%;
    color: inherit;
    padding: 6px 10px;
    background: transparent;
    border: none;
  }

  .color {
    height: auto;
    background: linear-gradient(135deg,
      hsl(0, 100%, 50%),
      hsl(30, 100%, 50%),
      hsl(60, 100%, 50%),
      /* hsl(90, 100%, 50%), */
      hsl(120, 100%, 50%),
      /* hsl(150, 100%, 50%), */
      hsl(180, 100%, 50%),
      /* hsl(210, 100%, 50%), */
      hsl(240, 100%, 50%),
      hsl(270, 100%, 50%),
      hsl(300, 100%, 50%)
      /* hsl(330, 100%, 50%), */
      /* hsl(360, 100%, 50%) */
  );
  }

  .button {
    display: flex;
    align-items: center;
    background: transparent;
    color: inherit;
    stroke: #FFFFFF;
    border: none;
    padding: 0px 10px;
    cursor: pointer;
  }
}
</style>
