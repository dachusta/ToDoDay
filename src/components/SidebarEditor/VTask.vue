<script setup>
defineProps({
  task: {
    type: Object,
    default: () => {}
  }
})
</script>

<template>
  <div class="task">
    <button
      class="button to-day"
      @click="$emit('toDay', task)"
    >
      🠔
    </button>
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
    <input
      type="color"
      class="color"
      :value="task.color"
      readonly
    >
    <button
      class="button"
      @click="$emit('removeTask', task.value)"
    >
      ✘
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
    background: transparent;
    color: inherit;
    border: none;
    padding: 0px 10px;
    cursor: pointer;
  }

  .to-day {
    border-right: 1px solid #FFFFFF;
  }
}
</style>
