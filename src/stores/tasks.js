import { ref } from 'vue'
import { defineStore } from 'pinia'
import axios from 'axios'

export const useTasksStore = defineStore('tasks', () => {
  const tasks = ref([])

  function setTasks () {
    const userId = 'test'

    axios
      .post(`${import.meta.env.VITE_URL}/tasks/setList?userId=${userId}`, tasks.value)
      .then(function (response) {
        console.log(response)
      })
      .catch(function (error) {
        console.log(error)
      })
  }
  function getTasks () {
    const userId = 'test'

    axios
      .get(`${import.meta.env.VITE_URL}/tasks/getList?userId=${userId}`)
      .then(function (response) {
        console.log(response)
        console.log(response.data)
        tasks.value = response.data
      })
      .catch(function (error) {
        console.log(error)
      })
  }

  function createTask (newTask) {
    tasks.value.unshift({
      priority: newTask.priority,
      value: newTask.value,
      color: newTask.color
    })
  }
  function removeTask (taskName) {
    tasks.value = tasks.value.filter((task) => taskName !== task.value)
  }

  return {
    tasks,
    setTasks,
    getTasks,
    createTask,
    removeTask
  }
})
