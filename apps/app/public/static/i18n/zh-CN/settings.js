// @ts-check
export default {
  sections: { profile: '个人资料', agents: 'Agent 接入', members: '成员', workspace: '工作区设置' },
  topBarContext: '/ 设置',
  sidebar: { label: '设置分类', personal: '个人' },
  save: '保存',
  actions: '操作',
  agents: {
    description: 'Claude Code、Codex、Cursor、Gemini CLI 等 agent 以你的身份发布和修改 artifact。agent 能做什么，由 token 的权限决定。',
    naming: {
      title: '1 · 给这个 agent 起个名字',
      description: '每个 agent 用自己的 token，丢了或不用了就单独撤销。名字只有你看得到。',
      nameLabel: '名字',
      namePlaceholder: '例如 Claude Code · 工作机',
      nameRequired: '给 agent 起个名字，比如它装在哪台机器上',
      expiryLabel: '有效期',
      expiry: { 90: '90 天', 30: '30 天', 365: '1 年', never: '永不过期' },
      scopeLabel: '权限',
      scopes: {
        publish: { label: '仅发布', description: '发布、更新和读取 artifact，处理评论和共享数据；不能修改谁能看到它。' },
        full: { label: '完全权限', description: '和你在网页上能做的一样，也能修改分享设置，比如设为公开链接。' },
      },
      create: '新建 token',
    },
    existingTokens: '已有的 token',
    setup: {
      title: '2 · 把配置填进 agent',
      tokenOnce: '这个 token 只显示这一次。离开这个页面后就看不到了。',
      /** @template T @param {T} name @returns {(string | T)[]} */
      tokenOf: name => ['「', name, '」的 token'],
      copyToken: '复制 token',
      tokenCopied: '已复制 token',
      pickClient: '选你用的 agent，复制下面的配置，token 已经填好了。改完配置后重启 agent。',
      /** @template T @param {T} header @returns {(string | T)[]} */
      httpNote: header => ['不支持 MCP 的 agent 直接调 HTTP API：先让它读 llms.txt，里面写了全部接口；', header, ' 填 agent 的名字，大家会看到是谁发布的。'],
      copyLlmsTxt: '复制 llms.txt 地址',
      /** @param {string} client */
      copySnippet: client => `复制 ${client} 配置`,
      copied: '已复制',
      otherClient: '其他（HTTP）',
      placements: {
        'claude-code': '在终端运行：',
        codex: '加到 ~/.codex/config.toml：',
        cursor: '加到项目里的 .cursor/mcp.json，或者全局的 ~/.cursor/mcp.json：',
        'gemini-cli': '加到 ~/.gemini/settings.json：',
        http: '发布一个页面试试：',
      },
      sampleClient: '我的脚本',
      sampleTitle: '连接测试',
      sampleBody: '你好',
    },
    check: {
      title: '3 · 让 agent 发布一个测试页',
      description: '重启 agent 后，把这句话发给它。页面发布后，这里会告诉你。',
      prompt: '用 open-artifact 发布一个测试页：标题「连接测试」，内容写一句你好。',
      copyPrompt: '复制这句话',
    },
    guidePack: {
      title: '指南包',
      description: '告诉 agent 什么时候发布、页面要遵守什么约定、该更新而不是新建。已经填好本实例的地址。',
      files: {
        'agents-md': { label: 'AGENTS.md 片段', savePath: '追加到仓库根目录的 AGENTS.md' },
        'claude-skill': { label: 'Claude Skill', savePath: '~/.claude/skills/open-artifact/SKILL.md' },
        'cursor-rule': { label: 'Cursor rules', savePath: '.cursor/rules/open-artifact.mdc' },
      },
      copyContent: '复制内容',
      /** @param {string} label */
      copied: label => `已复制 ${label}`,
    },
  },
  profile: {
    nameLabel: '名字',
    nameRequired: '写一个名字，团队成员会在评论和成员列表里看到它',
    nameHelp: '团队成员在评论、通知和成员列表里看到它。最多 60 个字。',
    emailLabel: '邮箱',
    emailHelp: '邮箱用来登录，不能修改。',
    appearance: '外观',
    themes: { system: '跟随系统', light: '浅色', dark: '深色' },
    appearanceHelp: '只对这台设备上的这个浏览器生效。',
  },
  members: {
    /** @param {{ count: number, isAdmin: boolean }} p */
    summary: ({ count, isAdmin }) => `${count} 人。${isAdmin ? '' : '要请同事加入，请管理员邀请。'}`,
    you: '（你）',
    allMembers: '全部成员',
    columns: { name: '名字', email: '邮箱', role: '角色' },
    /** @param {string} name */
    roleOf: name => `${name} 的角色`,
    lastAdmin: '工作区至少要有一位管理员',
    remove: '移除',
    cannotRemoveSelf: '不能移除自己',
  },
  invite: {
    title: '邀请同事',
    /** @param {number} days */
    description: days => `收到邀请的人登录后就会加入，不受邮箱域名限制。邮件邀请 ${days} 天后失效；邀请链接可以设为 7 天、30 天或永不过期，适合贴在团队群或入职文档里。`,
    emailsLabel: '用邮箱邀请',
    emailsHelp: '可以一次填多个，用逗号或换行分开。每人会收到一封带链接的邮件。',
    send: '发送邀请',
    createLink: '生成邀请链接',
    linkExpiry: '链接有效期',
    linkExpiries: { 7: '7 天', 30: '30 天', never: '永不过期' },
  },
  workspace: {
    nameLabel: '名称',
    nameRequired: '写一个名称，比如团队或项目的名字',
    nameHelp: '成员在侧栏和切换工作区时看到它。最多 40 个字。',
    publicLinks: {
      title: '公开链接',
      label: '允许成员把 artifact 分享为公开链接',
      help: '关闭后，现有的公开链接立即失效；成员仍然可以在工作区内查看。',
      /** @param {boolean} enabled */
      state: enabled => `${enabled ? '已允许' : '已关闭'} · 只有管理员可以修改`,
    },
    usage: {
      title: '用量',
      artifacts: 'Artifact',
      storage: '存储空间',
      /** @param {{ used: number, max: number }} count */
      artifactCount: ({ used, max }) => `${used.toLocaleString('zh-CN')} / ${max.toLocaleString('zh-CN')} 个`,
      /** @param {{ usedMb: number, maxGb: number }} size */
      storageSize: ({ usedMb, maxGb }) => `${usedMb.toLocaleString('zh-CN', { maximumFractionDigits: 1 })} MB / ${maxGb} GB`,
      /** @param {{ usedMb: number }} size */
      sharedDataSize: ({ usedMb }) => `其中 ${usedMb.toLocaleString('zh-CN', { maximumFractionDigits: 1 })} MB 是页面为访客保存的数据（共享数据）。`,
      /** @param {{ maxArtifacts: number, maxGb: number }} limits */
      help: ({ maxArtifacts, maxGb }) => `每个工作区最多 ${maxArtifacts.toLocaleString('zh-CN')} 个 artifact、${maxGb} GB 文件和共享数据，每个版本的文件都算。删除的 artifact 立即不占数量，但它的文件和数据要到 30 天后彻底清除，或在「最近删除」里永久删除后，才释放空间。`,
    },
    lifecycle: {
      title: '离开或删除',
      personalNote: '这是你的个人工作区，不能离开或删除，你一直是它的管理员。可以改名，也可以邀请别人进来一起用。',
      leaveLabel: '离开工作区',
      leaveHelp: '离开后你看不到这里的 artifact，你在这里的 token 也会失效；你发布的 artifact 留在工作区里。之后有人邀请你，你还能回来。',
      leave: '离开',
      deleteLabel: '删除工作区',
      deleteHelp: '所有成员立即失去访问，其中的 artifact、公开链接和 token 都停止工作。30 天内管理员可以在工作区菜单的「最近删除」里恢复，之后彻底删除。',
      delete: '删除工作区',
    },
    content: {
      title: '内容管理',
      description: '工作区里的全部 artifact。下架后所有人都看不到，作者也不能自己恢复；30 天内管理员可以恢复。私有 artifact 只显示标题，管理员也不能打开。',
      columns: { title: '标题', author: '作者', state: '状态', updated: '更新' },
      /** @param {boolean} takenDown */
      removedBadge: takenDown => `已${takenDown ? '下架' : '删除'}`,
      /** @param {{ name: string, takenDown: boolean, purge: string }} p */
      removedBy: ({ name, takenDown, purge }) => `${name} ${takenDown ? '下架' : '删除'} · ${purge}`,
      restore: '恢复',
    },
    audit: {
      title: '管理记录',
      /** @param {number} count */
      description: count => `${count > 0 ? `最近 ${count} 条` : '这里会记下'}删除、下架、恢复、重命名、邀请和成员变动。`,
      empty: '还没有管理记录。',
      events: {
        /** @param {{ actor: string, takenDown: boolean, title: string }} p */
        'artifact.removed': ({ actor, takenDown, title }) => `${actor} ${takenDown ? '下架' : '删除'}了「${title}」`,
        /** @param {{ actor: string, title: string }} p */
        'artifact.restored': ({ actor, title }) => `${actor} 恢复了「${title}」`,
        /** @param {{ actor: string, title: string }} p */
        'artifact.purged': ({ actor, title }) => `${actor} 永久删除了「${title}」`,
        /** @param {{ actor: string, from: string, to: string }} p */
        'artifact.renamed': ({ actor, from, to }) => `${actor} 把「${from}」重命名为「${to}」`,
        /** @param {{ actor: string, target: string }} p */
        'member.removed': ({ actor, target }) => `${actor} 把 ${target} 移出了工作区`,
        /** @param {{ actor: string, target: string, role: string }} p */
        'member.role_changed': ({ actor, target, role }) => `${actor} 把 ${target} 设为${role}`,
        /** @param {{ actor: string, email: string | null }} p */
        'member.invited': ({ actor, email }) => (email === null ? `${actor} 生成了一个邀请链接` : `${actor} 邀请了 ${email}`),
        /** @param {{ actor: string, email: string | null }} p */
        'invite.revoked': ({ actor, email }) => (email === null ? `${actor} 撤销了一个邀请链接` : `${actor} 撤销了给 ${email} 的邀请`),
        /** @param {{ actor: string, viaLink: boolean }} p */
        'member.joined': ({ actor, viaLink }) => (viaLink ? `${actor} 通过邀请链接加入了工作区` : `${actor} 接受邀请加入了工作区`),
        /** @param {{ actor: string, from: string, to: string }} p */
        'workspace.renamed': ({ actor, from, to }) => `${actor} 把工作区从「${from}」改名为「${to}」`,
        /** @param {{ actor: string }} p */
        'member.left': ({ actor }) => `${actor} 离开了工作区`,
        /** @param {{ actor: string }} p */
        'workspace.deleted': ({ actor }) => `${actor} 删除了工作区`,
        /** @param {{ actor: string }} p */
        'workspace.restored': ({ actor }) => `${actor} 恢复了工作区`,
      },
    },
  },
}
