<script setup>
import { onMounted, ref } from 'vue'
import IconArrowLeft from '../icons/IconArrowLeft.vue'
import IconTrashBin from '../icons/IconTrashBin.vue'

defineEmits(['add-task-in-day', 'update-task', 'remove-task'])

const props = defineProps({
  task: {
    type: Object,
    default: () => {}
  }
})

onMounted(() => {
  priority.value = props.task.priority
  value.value = props.task.value
  color.value = props.task.color
})

const priority = ref('')
const value = ref('')
const color = ref('')

</script>

<template>
  <div class="task">
    <button
      class="button task-in-day"
      @click="$emit('add-task-in-day', task)"
    >
      <IconArrowLeft />
    </button>
    <input
      v-model="priority"
      type="number"
      class="priority"
      @input="$emit('update-task', {
        _id: task._id,
        priority: $event.target.value,
        value,
        color
      })"
    >
    <input
      v-model="value"
      type="text"
      class="value"
      @input="$emit('update-task', {
        _id: task._id,
        priority,
        value: $event.target.value,
        color
      })"
    >
    <input
      v-model="color"
      type="color"
      class="color"
      @input="$emit('update-task', {
        _id: task._id,
        priority,
        value,
        color: $event.target.value
      })"
    >
    <button
      class="button"
      @click="$emit('remove-task', task._id)"
    >
      <IconTrashBin />
    </button>
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

  .task-in-day {
    border-right: 1px solid #FFFFFF;
  }
}
</style>
