import { ref } from 'vue'
import { defineStore } from 'pinia'
import axios from 'axios'
import { useDaysStore } from './days'

export const useTasksStore = defineStore('tasks', () => {
  const days = useDaysStore()
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
      _id: Date.now(),
      priority: newTask.priority,
      value: newTask.value,
      color: newTask.color
    })
  }
  function updateTask (newTask) {
    tasks.value.forEach(task => {
      if (newTask._id === task._id) {
        task.priority = newTask.priority
        task.value = newTask.value
        task.color = newTask.color
      }
    })
    days.updateTaskInDay(newTask)
  }

  function removeTask (taskId) {
    tasks.value = tasks.value.filter((task) => taskId !== task._id)
  }

  return {
    tasks,
    setTasks,
    getTasks,
    createTask,
    updateTask,
    removeTask
  }
})
