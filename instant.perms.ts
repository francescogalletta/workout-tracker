import type { InstantRules } from '@instantdb/react'

/**
 * Permissions for Lift — every entity is locked to its owner (SPEC §2:
 * "lock all InstantDB entities to the authenticated owner").
 *
 * Each row stores `owner = auth.id` (set on create by the write path). A user
 * may only view/create/update/delete rows they own; `update` additionally
 * requires the owner field to stay theirs (`newData.owner`), so a row can't be
 * handed to someone else. `$users`/`$files` stay locked down (no public access).
 *
 * Push with:  npx instant-cli@latest push perms
 * (interactive login required — the user does this; see the report for the
 *  copy-pasteable dashboard JSON equivalent.)
 */
const owned = {
  allow: {
    view: 'isOwner',
    create: 'isOwner',
    update: 'isOwner && stillOwner',
    delete: 'isOwner',
  },
  bind: [
    'isOwner',
    'auth.id != null && auth.id == data.owner',
    'stillOwner',
    'auth.id != null && auth.id == newData.owner',
  ],
}

const rules = {
  exercises: owned,
  routines: owned,
  routineItems: owned,
  sessions: owned,
  setLogs: owned,
  targets: owned,
  settings: owned,
  // $users intentionally omitted: it's a managed namespace whose defaults
  // already match (view = self only, update/delete locked); overriding
  // delete is rejected by the validator.
} satisfies InstantRules

export default rules
