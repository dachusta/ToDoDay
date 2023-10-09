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
// import axios from 'axios'

const days = useDaysStore()
const tasks = useTasksStore()
const editor = useEditorStore()

onMounted(() => {
  days.getList()
  tasks.getList()
})

// function test () {
//   axios
//     .get(`${import.meta.env.VITE_URL}/days/getTest`)
//     .then(function (response) {
//       console.log(response)
//       console.log(response.data)
//     })
//     .catch(function (error) {
//       console.log(error)
//     })
// }

//
// Доделать ТГ бота на бэке *
// Планировщик (setIntervel) должен запускаться автоматически с запуском приложения
//
// .env.develop добавить в гитхаб
//
// Добавить stylelinter
//
// Добавить иконки для приоритета
// Обновить все иконки
//
// Поискать кастомный прогресс-бар и вынести в отдельный компонент
//
// Добавить для кнопок стилей (ховер...)
// Добавить для инпутов стилей (при ридонли убирать оутлайн)
//
// По окончании дня сбрасывать состояние ВЫПОЛНЕНО (на бэке)
//
// Добавить кастомный чекбокс
// Поискать подходящие таймпикеры
//
// Заносить в статистику Выполненную задачу (userId/statistics)
// Продумать формат данных ( statistics: {???} )
//
// Добавить валидацию (нельзя создавать пустую задачу (или по умолчанил устанавливать прозрачность если возможно))
// Разделы Статистика и Дни должны быть некликабельными (И это должно быть видно)
//
// Выделить тему (Добавить возможность переключения темы)
//

</script>
<template>
  <div class="page">
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
        <!-- <VButton
          v-if="!editor.is"
          class="button-open"
          @click="test"
        >
          Тест
        </VButton> -->
      </div>

      <VDay
        v-for="(day, idx) in days.list"
        :key="day.id"
        :day="day"
        :order="idx"
        :selected-day-id="days.selectedDayId"
        :is-editor="editor.is"
        :count-task-done="days.countTaskDone"
        @remove-day="days.removeDay"
        @select-day="editor.selectDay"
        @remove-task="days.removeTask"
        @set-task-time="days.setTaskTime"
        @set-task-done="days.setTaskDone"
        @to-prev-day="days.toPrevDay"
        @to-next-day="days.toNextDay"
      />

      <!-- Режим редактора -->
      <VNewDay
        v-if="editor.is"
        :order="days.list.length"
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
  grid-template-columns: 1fr max-content;
  overflow: auto;
}

.days {
  /* grid-area: days; */
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
</style>
