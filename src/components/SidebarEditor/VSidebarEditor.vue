<template>
  <aside class="sidebar-editor">
    <div class="tabs">
      <span
        class="tab tab-tasks"
        @click="setTab('tasks')"
      >Дела</span>
      <span
        class="tab tab-days"
        @click="setTab('days')"
      >Дни</span>
    </div>

    <div
      v-if="curentTab === 'tasks'"
      class="tasks"
    >
      <header class="header">
        <div class="task-creator">
          <input
            v-model="newTask.priority"
            type="number"
            class="priority"
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
          <button @click="createTask">
            Создать
          </button>
        </div>
      </header>

      <main class="main">
        <div
          v-for="task in tasks"
          :key="task.value"
          class="task"
        >
          <button
            class="to-day"
            @click="$emit('toDay', task)"
          >
            {{ '<-' }}
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
          <button @click="removeTask(task.value)">
            Удалить
          </button>
        </div>
      </main>
    </div>

    <div
      v-if="curentTab === 'days'"
      class="days"
    >
      <span>Слева выберите созданный вами день, чтобы сохранить его в этом
        списке</span>
    </div>
  </aside>
</template>

<script setup>
import { ref, watch, onMounted } from 'vue'

const curentTab = ref('tasks')

function setTab (tabName) {
  curentTab.value = tabName
}

const newTask = ref({
  priority: 0,
  value: '',
  color: ''
})
const tasks = ref([])
watch(
  () => tasks.value,
  () => {
    localStorage.setItem('tasks', JSON.stringify(tasks.value))
  },
  { deep: true }
)
onMounted(() => {
  const tasksLS = localStorage.getItem('tasks')
  if (tasksLS) {
    tasks.value = JSON.parse(tasksLS)
  }
})

function createTask () {
  tasks.value.unshift({
    priority: newTask.value.priority,
    value: newTask.value.value,
    color: newTask.value.color
  })
}
function removeTask (taskName) {
  tasks.value = tasks.value.filter((task) => taskName !== task.value)
}
</script>

<style scoped>
.sidebar-editor {
  width: 500px;
  background: rgba(27, 30, 36, 0.7);

  .tabs {
    display: flex;

    .tab {
      display: flex;
      justify-content: center;
      align-items: center;
      width: 100%;
      height: 35px;
    }
  }

  .tasks {
    display: grid;
    gap: 30px;
    padding: 20px 50px 20px 50px;

    .main {
      display: grid;
      gap: 10px;
    }

    .task,
    .task-creator {
      display: flex;
      background: rgba(27, 30, 36, 0.5);
      padding: 2px 4px;
      border: 1px solid #ffffff;
      border-radius: 5px;

      .priority {
        width: 50px;
      }

      .value {
        width: 100%;
      }
    }
  }
}
</style>
