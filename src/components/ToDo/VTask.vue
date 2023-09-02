<template>
  <div
    class="task"
    :class="{ completed: task.checked }"
  >
    <input
      class="time"
      type="time"
      :value="task.time"
      @input="$emit('setTaskTime', { time: $event.target.value, task: task.value })"
    >
    <input
      type="number"
      class="priority"
      :value="task.priority"
      readonly
    >
    <input
      type="text"
      class="value"
      :value="task.value"
      readonly
    >
    <button
      v-if="isEditor"
      class="button"
      @click="$emit('removeTask', task.value)"
    >
      ✘
    </button>
    <input
      v-else
      class="checkbox"
      type="checkbox"
      :checked="task.checked"
      @input="$emit('setTaskChecked', { checked: $event.target.checked, task: task.value })"
    >
  </div>
</template>

<script setup>
// import { ref } from 'vue'
// import VButton from '../VButton.vue'
// import VInputText from '../VInputText.vue'

defineProps({
  task: {
    type: Object,
    required: true
  },
  isEditor: {
    type: Boolean,
    required: true
  }
})

// const time = ref('')
// const value = ref('')
// const checkbox = ref(false)
</script>

<style scoped>
.task {
  display: flex;
  background: rgba(27, 30, 36, 0.5);
  /* padding: 2px 4px; */
  border: 1px solid #ffffff;
  border-radius: 5px;
  color: #FFFFFF;

  &.completed {
    opacity: 0.3;
  }

  .time {
    /* width: 50px; */
    background: transparent;
    color: inherit;
    padding: 4px 8px;
    border: none;
    border-right: 1px solid #FFFFFF;
  }
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

  .checkbox {
    width: 30px;
    margin-right: 10px;
    margin-left: 5px;
  }

  .button {
    background: transparent;
    color: inherit;
    border: none;
    padding: 0px 10px;
    cursor: pointer;
    border-left: 1px solid #FFFFFF;
  }
}
</style>
