# JobPilot CN

面向中国求职场景的 AI 求职工作台。这个项目基于开源项目 [career-ops](https://github.com/santifer/career-ops) 借鉴和二次开发，新增了 Boss 直聘职位发现、中文岗位关键词过滤，以及项目内置的轻量浏览器访问能力。

> 说明：JobPilot CN 是一个非官方 fork，不隶属于、不代表、不受 career-ops 原作者或 Boss 直聘官方背书。上游项目采用 MIT License，本项目保留原版权和许可证说明，详见 [LICENSE](LICENSE) 和 [NOTICE.md](NOTICE.md)。

## 我们在原项目基础上做了什么

原项目 `career-ops` 已经提供了完整的求职流水线能力，包括职位评估、简历生成、pipeline 管理、ATS 扫描、批量处理等。JobPilot CN 主要补上中国招聘平台场景：

- 新增 Boss 直聘扫描命令：`npm run boss:scan`
- 新增项目内置的轻量 Web Access 能力，不依赖额外安装 Codex/Claude 的 `web-access` skill
- 新增 Chrome 登录态预检查命令：`npm run web:check`
- 新增中英混合岗位过滤词，覆盖 `AI产品经理`、`大模型`、`智能体`、`AIGC`、`解决方案架构师`、`自动化` 等方向
- 默认只做职位发现和整理，不自动投递、不自动沟通、不提交表单
- 保留上游的 pipeline、scan-history、简历生成和职位评估机制

## 适合谁

- 想系统化管理求职 pipeline 的个人用户
- 想筛选 Boss 直聘、中国 AI/产品/技术岗位的人
- 想把 AI Agent 用在“发现职位、整理职位、辅助判断是否值得投”的工作流里的人
- 想研究 career-ops 如何扩展到本土招聘平台的开发者

## 安装

```bash
git clone https://github.com/to-real/jobpilot-cn.git
cd jobpilot-cn
npm install
npx playwright install chromium
```

检查环境：

```bash
npm run doctor
```

第一次运行时，你还需要准备这些个人配置文件：

```bash
cp config/profile.example.yml config/profile.yml
cp templates/portals.example.yml portals.yml
```

然后编辑：

- `config/profile.yml`：你的姓名、目标岗位、城市、薪资范围等
- `portals.yml`：招聘平台、岗位关键词、Boss 直聘城市配置
- `cv.md`：你的简历 Markdown

这些文件属于个人数据，默认不会提交到 git。

## Boss 直聘扫描

公开搜索模式是默认方式：

```bash
npm run boss:scan -- --dry-run
npm run boss:scan -- --query "AI产品经理" --city Shanghai --max-pages 1
```

如果公开页面拿不到完整信息，脚本会提示你是否使用 Chrome 登录态。登录态模式不会自动开启，必须显式确认风险：

```bash
npm run web:check
npm run boss:scan -- --use-chrome --i-understand-login-risk
```

如果 Chrome Remote Debugging 没有打开，可以运行：

```bash
npm run web:check -- --open-settings
```

然后在 Chrome 页面里启用 `Allow remote debugging for this browser instance`。

## 配置 Boss 直聘

`portals.yml` 中的 Boss 配置示例：

```yaml
boss_zhipin:
  enabled: true
  access_mode: public_first
  keywords_from_profile: true
  keywords:
    - "AI产品经理"
    - "大模型产品经理"
  cities:
    - name: Shanghai
      code: "101020100"
    - name: Beijing
      code: "101010100"
    - name: Shenzhen
      code: "101280600"
    - name: Hangzhou
      code: "101210100"
  max_pages: 1
  rate_limit_ms: 2500
```

`title_filter.positive` 里已经包含常见中文关键词，例如：

- `AI产品`
- `AI产品经理`
- `产品经理`
- `大模型`
- `生成式AI`
- `智能体`
- `AIGC`
- `解决方案架构师`
- `自动化`

`title_filter.negative` 默认会过滤实习、校招、应届、初级等职位。

## 原有 career-ops 能力

JobPilot CN 仍然保留上游项目的大部分能力：

```bash
npm run scan       # 扫描 Greenhouse / Ashby / Lever 等国外 ATS
npm run verify     # 校验 pipeline
npm run liveness   # 检查职位链接是否仍然有效
npm run pdf        # 生成定制简历 PDF
```

更多上游设计可以参考：

- [career-ops upstream](https://github.com/santifer/career-ops)
- [docs/SETUP.md](docs/SETUP.md)
- [docs/SCRIPTS.md](docs/SCRIPTS.md)

## 安全边界

这个项目的 Boss 直聘功能只用于个人学习和个人求职工作流中的职位发现与整理：

- 不自动投递职位
- 不自动与招聘者聊天
- 不自动交换联系方式
- 不自动提交表单
- 不绕过验证码、风控或访问限制

使用 Chrome 登录态前，脚本会要求你显式确认风险。请遵守目标平台的服务条款和合理访问频率。

## 开源来源与授权

- 上游项目：[santifer/career-ops](https://github.com/santifer/career-ops)
- 浏览器访问思路参考：[eze-is/web-access](https://github.com/eze-is/web-access)
- 许可证：MIT

详见 [NOTICE.md](NOTICE.md)。
