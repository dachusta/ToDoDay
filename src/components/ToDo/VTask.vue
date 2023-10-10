<script setup>
import IconTrashBin from '../icons/IconTrashBin.vue'

defineEmits(['set-task-time', 'remove-task', 'set-task-done'])

defineProps({
  task: {
    type: Object,
    required: true
  },
  isEditor: {
    type: Boolean,
    required: true
  },
  isToDay: {
    type: Boolean,
    required: true
  }
})

</script>

<template>
  <div
    class="task"
    :class="{ completed: task.checked }"
    :style="{ background: task.color }"
  >
    <input
      class="time"
      type="time"
      :value="task.time"
      :readonly="isEditor"
      @input="$emit('set-task-time', { taskUniqId: task._uniqId, time: $event.target.value })"
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
      @click="$emit('remove-task', { taskUniqId: task._uniqId })"
    >
      <IconTrashBin />
    </button>
    <input
      v-else-if="isToDay"
      class="checkbox"
      type="checkbox"
      :checked="task.checked"
      @input="$emit('set-task-done', { taskUniqId: task._uniqId, checked: $event.target.checked })"
    >
  </div>
</template>

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

    &::-webkit-calendar-picker-indicator {
      background-image: url('../../assets/clock.png');
      width: 16px;
      height: 16px;
    }
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
    display: flex;
    align-items: center;
    background: transparent;
    color: inherit;
    stroke: #FFFFFF;
    border: none;
    padding: 0px 10px;
    cursor: pointer;
    border-left: 1px solid #FFFFFF;
  }
}
</style>
