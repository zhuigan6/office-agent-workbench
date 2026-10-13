# Office Agent Workbench

本地 Office 智能体工作台，本次版本为 **0.2.0-alpha.1**（第二版开发预览）。这是有明确边界的可试用版本，不是第二版全部完成或全功能正式版。

下载与安装见 [GitHub Releases](https://github.com/zhuigan6/office-agent-workbench/releases) 和 [安装说明](docs/INSTALLATION.md)。本次发布范围与第二版计划见 [发布范围](docs/RELEASE-SCOPE.md)。

目标是让独立窗口、命令行与外部智能体共用任务、对话和文档操作记录。
已放弃 Office 加载项部署，改用 Windows 原生连接器操作用户已打开的文档。
保留原版 AionCore 与 OfficeCLI，通过薄适配层集成，避免深度修改上游导致难以升级。
现有 Claude Office 8787 网关继续独立运行，不迁移或删除其用户数据。

## 当前已验证

- AionCore 经现有网关和 CC-Switch 调用 DeepSeek，实际文本回复与 MCP 调用成功。
- Windows 原生 Word 段落、Excel 数值/公式/格式、PPT 指定文本框读写测试，包含冲突拒绝和内容恢复。
- 外置界面发现三种已打开的 Office 文档；用户明确选择后才绑定，不自动启动 Office。
- 原版 OfficeCLI 修改工作副本，原件不受影响；文件库支持上传、检查和下载。
- 同一后台保存聊天，CLI 可读取会话；思考和工具详情默认折叠，工具请求保留审批。
- 登录计划任务实际启动、正常关闭和重新启动通过；运行中关闭返回 409。
- 工作台原生会话页与真实 Codex 终端已共享文档工具、固定选区和审批；支持已验收的正常接续、指定异常核对及取消分支，保留原会话 ID。
- Word 普通表格、正文多段，Excel 数据表和图表，PPT 文字、段落、文本框适应及多对象布局已有可组合原位编辑与恢复；具体对象范围见能力清单，不承诺任意复杂文档无损。
- 原版 AionCore 的 Claude 适配器已验证文档读取、准确参数审批及同一 vendor 会话的重启接续；原生 Claude 终端完整共享仍未完成。

原生 Claude/Codex 已有实际工具调用证据，Claude 图片与 PDF 文本读取、Codex
压缩后历史保留、三格式代表性复杂文件流程与只读历史导入也已验证。
**尚未完成**：完整 OfficeCLI 安全覆盖、更广的真实 Office 成品验收、其他智能体、
完整交互任务成本对照、第二台干净机器及长期运行验收。已有小样本模型计划和文件处理对照，不证明全面更快或更便宜。Claude 压缩成功仍未确认。
完整状态见 [能力清单](docs/CAPABILITIES.md)，引擎对照见 [性能基线](docs/BENCHMARK.md)。
不能把“能聊天”或“本地服务就绪”等同于这些能力已实现。

## 本地开发

要求 Windows、Node.js 24、需要实时编辑的桌面 Office，以及 upstreams.lock.json 指定的原版
AionCore/OfficeCLI。首次配置脚本会生成当前用户范围的 localhost 证书；不要
对已存在的数据重复初始化。不得关闭系统安全软件或绕过执行策略。

```powershell
npm.cmd ci --ignore-scripts
npm.cmd run check
npm.cmd test
npm.cmd run build
# 仅首次配置：传入已校验的上游二进制路径
.\scripts\Initialize-Local.ps1 -AionCore <aioncore.exe> -OfficeCli <officecli.exe>
.\scripts\Install-Service.ps1
.\scripts\Open-Workbench.ps1
```

正常打开 Office 文档，在工作台“Office 文档”页选择“连接并建任务”。
也可以新建文件任务，不打开 Office，在文件库处理副本。先在专用副本中测试。

登录后常驻采用当前用户计划任务，五分钟触发检查；不是登录前的系统服务。
停止用 `scripts/Stop-Service.ps1`，恢复用 `scripts/Install-Service.ps1`。
详见 [常驻部署](docs/SERVICE.md) 和 [CLI](docs/CLI.md)。`npm start` 仅用于开发，
不要与常驻任务同时运行。旧加载项脚本仅保留历史，不属于当前安装流程。

原生连接器有独立实例发现与绑定实现，已验证同文件的两个 Excel 实例；仍不保证发现全部 Word/PPT 多实例窗口。
标准 DOCX 的完整快照现可包含 Word 未保存内容，已通过真实 Word 只读打开验收；复杂文档与宏格式仍需专项验证。实时编辑不自动保存、不执行宏，不承诺任意格式无损回写。

## 数据和权限

- `.local/` 保存配对凭据、证书、AionCore 数据、文档日志、私有清单与产物。
  不得提交、发布或把该目录打进公开安装包。
- 原始聊天归 AionCore 管理；本项目保存文档绑定、操作、会话引用和用户主动导入的只读历史档案。
- 每个 MCP 凭据只授权一个会话绑定的文档；写入必须携带范围版本与操作 ID。
- 冲突不覆盖；丢失回执标为结果待确认，禁止盲目重试。
- 完整修改前后数据保存在本地日志，模型只接收必要的写入状态和版本。
- 本地用户及同一账户下的程序仍属于信任边界；这不是恶意程序隔离沙箱。

## 上游维护

只更新锁文件指向的某个组件，并单独运行协议测试、真实 Office 回归和回滚验收。
不混合上游升级与新业务功能；原版 Claude 插件仅作能力参考，不宣称复制其代码。
安装升级及恢复见 [安装说明](docs/INSTALLATION.md)，组件许可见
[第三方声明](THIRD-PARTY-NOTICES.md)。已完成的本机验收与尚未验证的边界见
[能力清单](docs/CAPABILITIES.md)；隔离目录测试不等于第二台干净机器测试。

PDF 支持按页提取文本层（每次最多 5 页、24,000 字符）；扫描件不冒充已识别。
原生智能体仍使用其自身图片能力与授权，不能保证所有模型支持视觉输入。

CSV／TSV 可导入已有工作簿的新副本，支持分隔符、小数点和表头设置。
公式型字段会明确拒绝，不会静默执行；需要公式时使用单独的显式编辑操作。
首版范围、已验证事实和待共同确认的工程缺口见 [本地评审状态](docs/READINESS.md)。

“历史档案”可导入工作台 JSON、Claude Code / Codex JSONL 的公开文本记录，
支持分页、重复导入识别和导出。它不会执行旧工具，也不等于恢复原智能体上下文。
导出前需自行检查敏感内容，详见 [历史导入边界](docs/HISTORY.md)。
