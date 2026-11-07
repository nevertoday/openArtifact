// @ts-check
export default /** @satisfies {import('../messages').Messages['notification']} */ ({
  actorLabel: ({ name, agentClient }) => (agentClient === null ? `${name} ` : `${agentClient} (for ${name}) `),
  sentences: {
    comment_on_my_artifact: ({ actor, title }) => `${actor}commented on your “${title}”`,
    reply_to_my_comment: ({ actor, title }) => `${actor}replied to your comment on “${title}”`,
    my_comment_resolved: ({ actor, title }) => `${actor}resolved your comment on “${title}”`,
    new_version: ({ actor, title }) => `${actor}published a new version of “${title}”`,
    shared_with_me: ({ actor, title }) => `${actor}shared “${title}” with you`,
    public_link_opened: ({ actor, title }) => `${actor}made “${title}” a public link`,
    access_requested: ({ actor, title }) => `${actor}asked you to share “${title}” with them`,
  },
})
