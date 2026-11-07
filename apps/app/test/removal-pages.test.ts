import { beforeAll, describe, expect, it } from 'vitest'
import { TestApp } from './test-app.ts'

const app = new TestApp()
let adminCookie = ''
let authorCookie = ''
let memberCookie = ''
let authorToken = ''

beforeAll(async () => {
  adminCookie = await app.signIn('admin@example.com')
  authorCookie = await app.signIn('author@example.com')
  memberCookie = await app.signIn('member@example.com')
  authorToken = await app.createToken(authorCookie)
})

async function pageText(path: string, cookie: string): Promise<string> {
  const response = await app.request(path, { cookie })
  expect(response.status).toBe(200)
  return response.text()
}

function jsonDataOf(markup: string, elementId: string): unknown {
  const json = markup.match(new RegExp(`<script type="application/json" id="${elementId}">(.*?)</script>`, 's'))?.[1]
  return json === undefined ? null : JSON.parse(json)
}

describe('viewer page actions', () => {
  it('offers 重命名 and 删除 to the author, 重命名 to an editor, 下架 to an admin, and nothing to a member', async () => {
    const published = await app.publish({ token: authorToken }, 'Menu check', '<h1>x</h1>', 'specified')
    await app.grant(authorCookie, published.artifactId, 'member@example.com', 'editor')
    const memberOnly = await app.publish({ token: authorToken }, 'Member view')

    const authorMarkup = await pageText(published.path, authorCookie)
    const editorMarkup = await pageText(published.path, memberCookie)
    const adminMarkup = await pageText(memberOnly.path, adminCookie)
    const memberMarkup = await pageText(memberOnly.path, memberCookie)

    expect(authorMarkup).toContain('data-rename-artifact')
    expect(authorMarkup).toMatch(/data-remove-artifact[^>]*>.*删除<\/button>/)
    expect(editorMarkup).toContain('data-rename-artifact')
    expect(editorMarkup).not.toContain('data-remove-artifact')
    expect(adminMarkup).not.toContain('data-rename-artifact')
    expect(adminMarkup).toMatch(/data-remove-artifact[^>]*>.*下架<\/button>/)
    expect(jsonDataOf(adminMarkup, 'viewer-config')).toMatchObject({ permissions: { canRemove: true, canRename: false }, removalTakesDown: true })
    expect(memberMarkup).not.toContain('data-artifact-menu')
  })
})

describe('recently removed on the home page', () => {
  it('moves a removed artifact out of every filter into 最近删除, with days left and a way back', async () => {
    const published = await app.publish({ token: authorToken }, 'Oops page')
    await app.request(`/api/artifacts/${published.artifactId}`, { method: 'DELETE', cookie: authorCookie })

    const homeMarkup = await pageText(`/?removed=${published.artifactId}`, authorCookie)
    const mineMarkup = await pageText('/?filter=mine', authorCookie)
    const removedMarkup = await pageText('/?filter=removed', authorCookie)
    const memberRemovedMarkup = await pageText('/?filter=removed', memberCookie)

    expect(homeMarkup).not.toContain('<p class="xxd-card__title">Oops page</p>')
    expect(homeMarkup).toMatch(/最近删除<\/span><span class="xxd-badge"\s*title="1 个 artifact">1<\/span>/)
    expect(jsonDataOf(homeMarkup, 'home-config')).toEqual({ justRemoved: { artifactId: published.artifactId, title: 'Oops page', removedAsAdmin: false } })
    expect(mineMarkup).not.toContain('Oops page')
    expect(removedMarkup).toContain('Oops page')
    expect(removedMarkup).toContain(`data-restore-artifact="${published.artifactId}"`)
    expect(removedMarkup).toContain('30 天后彻底删除')
    expect(removedMarkup).not.toContain(`href="${published.path}"`)
    expect(memberRemovedMarkup).not.toContain('Oops page')
  })
})

describe('settings for an admin', () => {
  it('lets an admin change roles and remove members, but not remove themselves or demote the last admin', async () => {
    const adminMembers = await pageText('/settings/members', adminCookie)
    const memberMembers = await pageText('/settings/members', memberCookie)

    expect(adminMembers).toContain('data-member-role')
    expect(adminMembers).toContain('data-remove-member')
    expect(adminMembers).toContain('不能移除自己')
    expect(adminMembers).toContain('workspace 至少要有一位管理员')
    expect(memberMembers).not.toContain('data-member-role')
    expect(memberMembers).not.toContain('data-remove-member')
  })

  it('shows every artifact as metadata with 下架 and 恢复, and the audit log as sentences', async () => {
    const privatePage = await app.publish({ token: authorToken }, 'Hidden diary', '<h1>private</h1>', 'private')
    const takenDown = await app.publish({ token: authorToken }, 'Leaked roadmap')
    await app.request(`/api/artifacts/${takenDown.artifactId}`, { method: 'DELETE', cookie: adminCookie })
    await app.request(`/api/artifacts/${privatePage.artifactId}`, { method: 'PATCH', cookie: authorCookie, body: { title: 'Hidden diary 2' } })

    const adminWorkspace = await pageText('/settings/workspace', adminCookie)
    const memberWorkspace = await pageText('/settings/workspace', memberCookie)

    expect(adminWorkspace).toContain('内容管理')
    expect(adminWorkspace).toContain('Hidden diary 2')
    expect(adminWorkspace).not.toContain(`href="${privatePage.path}"`)
    expect(adminWorkspace).toContain(`data-remove-artifact="${privatePage.artifactId}"`)
    expect(adminWorkspace).toContain(`data-restore-artifact="${takenDown.artifactId}"`)
    expect(adminWorkspace).toContain('管理记录')
    expect(adminWorkspace).toContain('admin 下架了「Leaked roadmap」')
    expect(adminWorkspace).toContain('author 把「Hidden diary」重命名为「Hidden diary 2」')
    expect(adminWorkspace).not.toContain('private</h1>')
    expect(memberWorkspace).not.toContain('内容管理')
    expect(memberWorkspace).not.toContain('管理记录')
  })
})
