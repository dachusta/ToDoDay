<template>
  <div class="day">
    <div class="info">
      <span>Сегодня / ПН</span>
      <!-- <span>Day: 1</span> -->
    </div>
    <div
      class="create"
      @click="$emit('createDay')"
    >
      +
    </div>
  </div>
</template>

<script setup>

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

  .create {
    display: flex;
    justify-content: center;
    align-items: center;
    width: 100px;
    height: 100px;
    border-radius: 5px;
    font-size: 48px;
    opacity: 0.5;
    background: rgb(27, 30, 36);
  }
}
</style>
