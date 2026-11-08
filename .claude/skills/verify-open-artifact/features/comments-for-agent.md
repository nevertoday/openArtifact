# Comments for the agent

A person leaves a comment pinned to a spot or a passage of the page and can mark it 给 agent. The agent finds open agent comments across artifacts, updates the page, and replies with resolve, which closes the thread for the person.

## Sub-features

- `comment-add` adds a comment with an anchor, visible in the viewer's comment count.
- `comment-for-agent` flags the comment for the agent.
- `comment-agent-list` lets the agent's MCP `list_my_comments` (or `GET /api/comments?for=me&status=open`) return it.
- `comment-reply-resolve` lets the agent reply with `resolve: true`, so the thread is resolved and drops out of the agent's list.

## How to get to it (user POV)

- In the viewer, press `C` or click `[data-comment-mode]`, click a spot in the page, write in `[data-composer]`, switch on 给 agent (`[name=forAgent]`), and send.
- Agent: MCP `list_my_comments`, `list_comments`, `reply_comment`.

## Driving it with oa-verify

Preconditions:

- An artifact `<id>` published as in [publish-and-view](./publish-and-view.md).

- **Add (as the person).** Run `node $V api POST /api/artifacts/<id>/comments --as session --body '{"body":"把标题改成蓝色","forAgent":true,"anchor":{"x":0.2,"y":0.1,"version":1}}'`. Status 201, with `comment.forAgent: true` and a `commentId`.
- **Person sees it.** Run `node $V browse <path> --wait '[data-comment-count]' --eval 'document.querySelector("[data-comment-count-button]").click(); new Promise(r=>setTimeout(r,800)).then(()=>JSON.stringify({count:document.querySelector("[data-comment-count]").textContent,agentPins:document.querySelectorAll(".comment-thread .comment-pin[data-state=agent]").length,resolve:!!document.querySelector(".comment-thread__resolve"),more:!!document.querySelector(".comment-thread__more")}))' --shot comment-drawer`. The count is at least 1, there is an agent pin, and the resolve and more icons exist.
- **Agent finds it.** Run `node $V mcp list_my_comments`. `result.content[0].text` contains the `commentId`, `"title"` and the anchor.
- **Reply and resolve.** Run `node $V mcp reply_comment --args '{"artifactId":"<id>","commentId":"<commentId>","body":"改好了，见 v2"}'`. The text is `Replied and marked the comment resolved.` (`resolve` defaults to true).
- **Gone from the agent's list.** Run `node $V mcp list_my_comments` again. The `commentId` is absent.
- **Person sees it resolved.** Run `node $V browse <path> --wait '[data-comment-count]' --eval 'document.querySelector("[data-comment-count-button]").click(); new Promise(r=>setTimeout(r,600)).then(()=>{document.querySelector("[data-comment-filters] [data-value=all]")?.click(); return new Promise(r=>setTimeout(r,600))}).then(()=>JSON.stringify({count:document.querySelector("[data-comment-count]").textContent,pin:document.querySelector(".comment-thread .comment-pin")?.dataset.state}))' --shot comment-resolved`. The count is `0` and the pin state is `resolved`.
- **Proof.** The add JSON, `comment-drawer.png`, `comment-resolved.png`, and both `list_my_comments` outputs.

## Gotchas

- `<path>` is the `path` that `publish` printed.
- Thread actions are icons, not text buttons: `.comment-thread__resolve` (aria-label `解决评论 N`), `.comment-thread__reply-toggle`, and `.comment-thread__more`, which opens a `[role=menu]` with copy for agent, copy link and delete.
- A resolved thread shows only under the 全部 filter, folded to one line (`article.comment-thread[data-folded="true"]`) unless it is the selected thread. The first thread in the drawer is selected, so a lone thread reads `data-folded=""`.
- Only a thread root can be `forAgent`. Replies ignore the flag.
- The UI path (clicking into the frame in comment mode) needs a click inside the sandboxed frame. The API path is the reliable driver, and the viewer screenshot covers what the person sees.
- `list_my_comments` covers artifacts the token's person can edit. A `member@example.com` token won't see the founder's private artifacts.
