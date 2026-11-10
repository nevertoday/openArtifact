// Sample artifacts that read like what agents really publish: reports with charts, written documents, design
// mock-ups and comparison tables, with Chinese and English mixed and a few very long titles.

const TOPICS = [
  ['Q3 增长复盘', 'report'], ['定价方案对比', 'table'], ['新人入职指南', 'doc'], ['2027 产品路线图', 'doc'], ['发布会文案草稿', 'doc'],
  ['用户访谈报告', 'report'], ['Checkout 改版设计稿', 'design'], ['API 迁移计划', 'doc'], ['竞品分析：Notion、Linear 与 Figma', 'table'], ['留存漏斗周报', 'report'],
  ['Onboarding flow redesign', 'design'], ['Weekly metrics digest', 'report'], ['Incident review: checkout latency on Black Friday', 'doc'], ['品牌视觉规范 v2', 'design'], ['销售话术手册', 'doc'],
  ['Mobile app 首页改版方案（含三套备选布局与可用性测试结论）', 'design'], ['年度 OKR 对齐', 'table'], ['客服常见问题', 'doc'], ['A/B 实验结果：新定价页', 'report'], ['Design system audit', 'table'],
]
const EDITIONS = ['', '（修订）', ' · 10 月', ' · 11 月', ' · draft']
const ACCENTS = ['#2563eb', '#db2777', '#059669', '#d97706', '#7c3aed', '#0891b2']

/** The title and page of the sample at `index`; the same index always gives the same page. */
export function samplePage(index) {
  const [topic, kind] = TOPICS[index % TOPICS.length]
  const title = `${topic}${EDITIONS[Math.floor(index / TOPICS.length) % EDITIONS.length]}`
  const accent = ACCENTS[index % ACCENTS.length]
  return { title, html: PAGE_KINDS[kind](title, accent, index) }
}

const shell = (title, accent, body) => `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>
<style>
  body { margin: 0; font: 16px/1.6 system-ui, "PingFang SC", sans-serif; color: #1c1917; background: #fff; }
  main { max-width: 860px; margin: 0 auto; padding: 48px 32px 96px; }
  h1 { font-size: 34px; line-height: 1.2; margin: 0 0 8px; letter-spacing: -0.01em; }
  h2 { font-size: 20px; margin: 40px 0 12px; }
  .lede { color: #57534e; margin: 0 0 32px; }
  .tiles { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
  .tile { border: 1px solid #e7e5e4; border-radius: 12px; padding: 16px; }
  .tile b { display: block; font-size: 28px; color: ${accent}; }
  .tile span { color: #78716c; font-size: 13px; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid #e7e5e4; }
  th { color: #78716c; font-weight: 500; }
  .hero { border-radius: 16px; padding: 40px; color: #fff; background: linear-gradient(135deg, ${accent}, #1c1917); }
  .frames { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-top: 24px; }
  .frame { aspect-ratio: 9 / 16; border-radius: 16px; border: 1px solid #e7e5e4; background: linear-gradient(${accent}22, #fff 40%); padding: 14px; }
  .frame i { display: block; height: 10px; border-radius: 5px; background: #e7e5e4; margin-bottom: 8px; }
  .frame i:first-child { width: 60%; background: ${accent}; }
</style></head><body><main>${body}</main></body></html>`

const bars = (accent, seed) => {
  const heights = [0, 1, 2, 3, 4, 5, 6, 7].map(step => 40 + ((seed * 37 + step * 53) % 110))
  return `<svg viewBox="0 0 520 180" role="img" aria-label="trend" style="width:100%;margin-top:8px">${heights.map((height, step) => `<rect x="${step * 64 + 8}" y="${170 - height}" width="44" height="${height}" rx="6" fill="${accent}" opacity="${0.45 + step * 0.07}"/>`).join('')}</svg>`
}

const PAGE_KINDS = {
  report: (title, accent, seed) => shell(title, accent, `<h1>${title}</h1><p class="lede">本期要点：新增用户环比上升，Activation 比上一周期高 4.2 个百分点，付费转化持平。</p>
<div class="tiles"><div class="tile"><b>${12 + (seed % 30)}.4k</b><span>新增用户 New users</span></div><div class="tile"><b>${38 + (seed % 20)}%</b><span>七日留存</span></div><div class="tile"><b>¥${80 + (seed % 60)}万</b><span>MRR</span></div></div>
<h2>趋势</h2>${bars(accent, seed)}<h2>要点一</h2><p>自然流量贡献了主要增长，SEO 落地页的跳出率下降。</p><h2>要点二</h2><p>留存率的口径：注册后第 7 天仍有一次有效会话。</p>`),
  doc: (title, accent, seed) => shell(title, accent, `<h1>${title}</h1><p class="lede">这份文档由 agent 起草，供团队评审。Last updated in sprint ${20 + (seed % 9)}.</p>
<h2>背景</h2><p>我们在过去两个季度里收到了大量关于流程繁琐的反馈。这份方案把步骤从七步减到三步，并保留了审批记录。</p>
<h2>方案</h2><ol><li>合并入口，只保留一个“开始”按钮。</li><li>把必填项减到四个，其余放进 Advanced。</li><li>提交后立即给出可分享的链接。</li></ol>
<h2>风险</h2><p>旧链接需要保留 90 天的重定向。迁移期间两个版本并行。</p><h2>时间表</h2><p>第一周完成设计评审，第二周灰度 10%，第四周全量。</p>`),
  table: (title, accent) => shell(title, accent, `<h1>${title}</h1><p class="lede">三个方案在价格、上手成本与扩展性上的对比。</p>
<table><thead><tr><th>维度</th><th>Starter</th><th>Team</th><th>Enterprise</th></tr></thead><tbody>
<tr><td>价格</td><td>¥0</td><td>¥99 / 人 / 月</td><td>联系销售</td></tr><tr><td>成员数</td><td>3</td><td>50</td><td>不限</td></tr><tr><td>版本历史</td><td>7 天</td><td>90 天</td><td>永久</td></tr><tr><td>SSO</td><td>—</td><td>—</td><td>SAML / OIDC</td></tr><tr><td>支持</td><td>社区</td><td>工作日 8 小时</td><td>专属 Slack</td></tr></tbody></table>
<h2>结论</h2><p>Team 档的性价比最高，建议作为默认推荐。</p>`),
  design: (title, accent) => shell(title, accent, `<div class="hero"><h1>${title}</h1><p>三套备选布局，Option B 在可用性测试里完成率最高。</p></div>
<div class="frames"><div class="frame"><i></i><i></i><i></i><i></i></div><div class="frame"><i></i><i></i><i></i></div><div class="frame"><i></i><i></i><i></i><i></i><i></i></div></div>
<h2>设计说明</h2><p>首屏只保留一个主操作。导航收进底部 Tab，搜索上移到标题栏。</p>`),
}
