# Security / 安全

## Reporting a vulnerability / 报告漏洞

Please report vulnerabilities privately through GitHub: **Security › Report a vulnerability** on this repository. Do not open a public issue. You will hear back within 7 days.

请通过 GitHub 私下报告：在本仓库的 **Security › Report a vulnerability** 里提交，不要开公开 issue。我们会在 7 天内回复。

## Security model / 安全模型

Open Artifact serves HTML that agents and people publish, so artifact pages are treated as untrusted:

- Artifact files are served by the **usercontent** Worker on a separate site from the app, inside a sandboxed iframe without `allow-same-origin`. A page cannot read the app's cookies or storage.
- File addresses are signed and expire; usercontent has no storage binding of its own and reads files through the app.
- App pages run only the app's own scripts (`script-src 'self'`), escape every value they show, and refuse cross-site writes.
- Public links can have an expiry and a password; password attempts are rate-limited, and so are sign-in codes, per recipient and per sender. A sign-in code is six digits, lives ten minutes, is stored only as a hash and stops working after three wrong tries. After ten wrong codes in a day, an address cannot sign in with a code until that day has passed.
- API tokens have scopes; a `publish` token cannot change sharing, list on a personal page, or remove artifacts.

Open Artifact 托管的是 agent 和人发布的 HTML，所以 artifact 页面一律按不受信任处理：

- artifact 文件由 **usercontent** Worker 在与 app 不同的站点上提供，放在不带 `allow-same-origin` 的沙箱 iframe 里，页面读不到 app 的 cookie 和存储。
- 文件地址带签名并会过期；usercontent 自身没有存储绑定，通过 app 读取文件。
- app 的页面只运行自己的脚本（`script-src 'self'`），所有显示的值都经过转义，并拒绝跨站写请求。
- 公开链接可以设有效期和密码；密码尝试有频率限制，登录验证码也按收件人和发起方限制频率。验证码是 6 位数字，10 分钟内有效，数据库里只存哈希，输错 3 次即作废。同一个邮箱一天内输错 10 次后，要等满一天才能再用验证码登录。
- API token 分权限；`publish` token 不能改分享设置、不能列到个人主页、不能删除 artifact。

Reports about these boundaries are the most valuable. / 针对这些边界的报告最有价值。
