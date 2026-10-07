import { defineBoot } from '#q-app/wrappers'
import { db, ensureCycleState } from 'src/services/db'

export default defineBoot(async () => {
  await db.open()
  await ensureCycleState()
})
