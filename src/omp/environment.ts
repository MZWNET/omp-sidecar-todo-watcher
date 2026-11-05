import * as v from 'valibot'
import { watcherModeSchema } from './runner.ts'

const optionalSetting = v.pipe(
  v.optional(v.string()),
  v.transform(value => (value === '' ? undefined : value)),
)

const environmentSchema = v.object({
  OMP_PEER_ID: optionalSetting,
  OMP_PEER_BROKER_DB: optionalSetting,
  OMP_WATCHER_MODEL: optionalSetting,
  OMP_WATCHER_MODE: v.fallback(watcherModeSchema, 'auto'),
})

/** The plugin's environment variables, with empty values treated as unset */
export function readEnvironment(env: NodeJS.ProcessEnv): v.InferOutput<typeof environmentSchema> {
  return v.parse(environmentSchema, env)
}
