# Surge IP Labeler

此项目为私有 Surge 策略订阅增加出口 IP 情报标签，并把更新后的策略提交到你的同步服务。仓库与 GitHub Pages 只发布可复用代码和占位配置，绝不提交订阅地址、密码、UUID 或令牌。

## 设置

1. Fork 此仓库，启用仓库的 GitHub Pages（Source 选择 GitHub Actions），并在 Pages 设置中确认自定义域名或默认地址。
2. 在 Surge 添加模块：`https://<你的 GitHub 用户名>.github.io/<仓库名>/module.sgmodule`。
3. 在模块参数中填写：
   - `source_url`：你的私有策略订阅地址；
   - `upload_url`：你自己部署的受保护同步 Worker 地址；
   - `upload_token`：与 Worker 的同步密钥。
4. 在目标配置中应用 [patches/policy-path.template.diff](patches/policy-path.template.diff) 的路径变更；先将其中示例 URL 替换为你的受保护同步地址。
5. 手动执行一次模块或等待 cron 任务。成功后确认策略名称带有 IP 标签，且同步端只接受带有效授权头的写入请求。

不要把上述三个参数写入模块文件、README、Issues、Actions 日志或公开的 Surge 配置。修改前运行 `npm test`；Pages 工作流也会在部署 `site/` 前运行同一套测试。

## 回滚

1. 在 Surge 禁用或删除该模块。
2. 将目标配置中的策略路径恢复为应用补丁前的地址，然后重新加载配置。
3. 在同步 Worker 侧撤销当前同步密钥；若密钥曾公开，立即轮换它。
4. 如需停止公开模块，关闭 GitHub Pages 或删除 Pages 环境部署；保留私有订阅和同步端的访问控制。
