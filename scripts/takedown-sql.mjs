// The SQL behind scripts/takedown.mjs, apart from the command so tests can run it against a database.

/** ArtifactRemoval.OPERATOR in packages/core: a removal by this id cannot be restored by anyone. */
const OPERATOR = 'operator'
const SHORT_ID = /^[0-9a-z]{12}$/

/** The short id in an artifact's link (/a/{slug}-{short id}), its address segment, or the short id itself; null when there is none. */
export function shortIdOf(reference) {
  let segment = reference.trim()
  if (/^https?:\/\//i.test(segment)) segment = decodeURIComponent(new URL(segment).pathname.split('/')[2] ?? '')
  const shortId = segment.slice(segment.lastIndexOf('-') + 1).toLowerCase()
  return SHORT_ID.test(shortId) ? shortId : null
}

/**
 * Removes the artifact as an admin takedown by the operator, and records it in its workspace's audit log. An
 * artifact its author already removed keeps its removal time, so its purge date does not move. Running it twice
 * changes nothing more than once, apart from a second audit entry.
 */
export function takedownSql(shortId, now) {
  if (!SHORT_ID.test(shortId)) throw new Error(`"${shortId}" is not a short id`)
  if (!Number.isSafeInteger(now)) throw new Error(`"${now}" is not a time in milliseconds`)
  return [
    `INSERT INTO audit_events (id, workspace_id, actor_id, action, target_type, target_id, detail, created_at)
  SELECT lower(hex(randomblob(16))), workspace_id, '${OPERATOR}', 'artifact.removed', 'artifact', id, json_object('title', title, 'removedAsAdmin', json('true')), ${now}
  FROM artifacts WHERE short_id = '${shortId}';`,
    `UPDATE artifacts SET removed_at = COALESCE(removed_at, ${now}), removed_by = '${OPERATOR}', removed_as_admin = 1 WHERE short_id = '${shortId}';`,
  ].join('\n')
}
