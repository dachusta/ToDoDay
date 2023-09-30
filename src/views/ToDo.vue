<script setup>
import { onMounted } from 'vue'
import VDay from '../components/ToDo/VDay.vue'
import VNextDay from '../components/ToDo/VNextDay.vue'
import VNewDay from '../components/ToDo/VNewDay.vue'
import VSidebarEditor from '../components/SidebarEditor/VSidebarEditor.vue'
import VButton from '../components/VButton.vue'
import { useDaysStore } from '../stores/days'
import { useTasksStore } from '../stores/tasks'
import { useEditorStore } from '../stores/editor'

const days = useDaysStore()
const tasks = useTasksStore()
const editor = useEditorStore()

onMounted(() => {
  days.getDays()
  tasks.getTasks()
})

// days/setTimeTask (dayId, taskId) - устанавливать время только в режиме просмотра (в режиме редактора элемент readonly/disabled)
// days/setDoneTask (dayId, taskId) - устанавливать в выполнено только в режиме просмотра
//
// Переименовать все методы в сторах
// days.days --> days.list или days.value - если не получатся days.value.value :)
// days.saveDays() --> days.save() но days.createDay() --> days.createDay()
// и т.д.    в тасках, и поискать еще где-то
//
// Доделать ТГ бота на бэке
//
// ToDo.vue перенести в App.vue. В ToDo.vue должно быть только... ???? ... только страница с днями, задачи и редактор. Статистика в другом компоненте

</script>
<template>
  <div class="page">
    <header class="header">
      <div class="container">
        <nav class="nav">
          <span>Задачи</span>
          <span>Статистика</span>
        </nav>
      </div>
    </header>
    <main class="days">
      <div
        class="buttons-editor"
      >
        <VButton
          v-if="editor.is"
          class="button-save"
          @click="editor.save"
        >
          Сохранить
        </VButton>

        <VButton
          v-if="editor.is"
          class="button-cancel"
          @click="editor.cancel"
        >
          Отменить
        </VButton>

        <VButton
          v-if="!editor.is"
          class="button-open"
          @click="editor.open"
        >
          Редактировать
        </VButton>
      </div>

      <VDay
        v-for="(day, idx) in days.days"
        :key="day.id"
        :day="day"
        :order="idx"
        :selected-day-id="days.selectedDayId"
        :is-editor="editor.is"
        @remove-day="days.removeDay"
        @select-day="days.selectDay"
        @remove-task="days.removeTask"
        @set-task-time="days.setTaskTime"
        @set-task-done="days.setTaskDone"
        @to-prev-day="days.toPrevDay"
        @to-next-day="days.toNextDay"
      />

      <!-- Режим редактора -->
      <VNewDay
        v-if="editor.is"
        :order="days.days.length"
        @create-day="days.createDay"
      />

      <!-- Режим просмотра -->
      <VNextDay
        v-if="false"
        :day="null"
      />
      <!-- <VDay :day="day[0]" /> -->
    </main>
    <VSidebarEditor
      v-if="editor.is"
      class="sidebar"
    />
  </div>
</template>

<style scoped>
.page {
  display: grid;
  grid-template-areas:
    'header header'
    'days sidebar';
  grid-template-columns: 1fr max-content;
  grid-template-rows: 60px auto;
  height: 100vh;
  color: #fff;
  background: linear-gradient(#6b7587, #1b1e24);
  font-family: Arial, Helvetica, sans-serif;
  /* padding: 0 30px; */
}

.header {
  grid-area: header;
  /* height: 60px;
  position: fixed;
  top: 0;
  left: 0;
  right: 0; */
  display: flex;
  background: rgba(27, 30, 36, 0.5);
}

.container {
  max-width: 1440px;
  width: 100%;
  margin: 0 auto;
}

.nav {
  display: flex;
  /* gap: 30px; */
  height: 100%;
}

.nav span {
  display: flex;
  align-items: center;
  height: 100%;
  padding: 0px 30px;
}

.days {
  grid-area: days;
  position: relative;
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  align-content: flex-start;
  column-gap: 30px;
  row-gap: 50px;
  padding: 70px 50px 50px 50px;
  overflow: auto;
}

.buttons-editor {
  position: absolute;
  top: 10px;
  right: 10px;
  display: flex;
  gap: 10px;
}
.buttons-editor button {
  padding: 15px 30px;
  border-radius: 5px;
  color: inherit;
  border: none;
  background: rgba(27, 30, 36, 0.7);
}

.sidebar {
  grid-area: sidebar;
}
</style>
