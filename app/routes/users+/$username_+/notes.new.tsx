import { type LoaderFunctionArgs, json } from '@remix-run/node'
import { requireUserId } from '#app/utils/auth.server.ts'
import { NoteEditor, action } from './__note-editor.tsx'

export async function loader({ request }: LoaderFunctionArgs) {
  await requireUserId(request)
  return json({})
}

export { action }
export default NoteEditor
