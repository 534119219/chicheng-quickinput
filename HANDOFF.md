# chicheng-quickinput — 交接摘要（HANDOFF）

> 生成时间：2026-08-17。用于在新对话中继续本插件开发。
> 新对话第一步建议：`read D:\Harness\chicheng-vault\HANDOFF.md`（本文件），再按需 `read lib/client.js` / `lib/index.js`。

---

## 一、项目概况

- **插件名**：`chicheng-vault`（npm 包名）；**GitHub 仓库**：`534119219/chicheng-quickinput`（公开，描述/标签已配好）
- **作用**：DSH（DeepSeek Harness）Web 的「便捷输入保险箱」插件 —— 输入栏「用量」与「发送」之间灰色圆钮，点开面板收录/管理密钥、服务器、手机号、网址等敏感信息，点击填入输入框（追加到光标处），Ctrl+点击直接发送；私密内容密码保护 + WebDAV 备份。
- **技术形态**：DSH client plugin（`exports["./client"]` → 手写 bundle `lib/client.js`，`window.__ModuleLoader__.load({id, factory})` 包裹）+ host 插件（`lib/index.js`，服务端启动时加载）。
- **依赖**：运行时零第三方（host 仅用 Node 内置模块）；client 用 shell 静态模块表中的 `react` / `react-dom` / `@deepseek-ai/dsh-client-ui-primitives`。

## 二、仓库与部署

- 本地目录：`D:\Harness\chicheng-vault`（已 `git init`，分支 `main`，remote=`https://github.com/534119219/chicheng-quickinput.git`）
- **git 身份**：`534119219` / `534119219@users.noreply.github.com`（与其他 chicheng-* 项目一致）
- 最新提交：`8ab0268`（9 个提交，全部已推送，工作区干净）
- profile 安装：`C:\Users\TJ\.dsh\profiles\web`，依赖为 `file:D:/Harness/chicheng-vault`，经 junction 链接（`D:\Harness\relink-plugins.ps1`）保证编辑即时生效；`dsh.profile.bundles` 已含 `chicheng-vault`（当时 pnpm 因 `@google/genai` 的 `ERR_PNPM_IGNORED_BUILDS` 退出码 1，bundles 需手动补，勿依赖 `dsh plugin add` 自动完成）
- **生效规则**：改 `lib/client.js` → 浏览器 **Ctrl+F5** 即可；改 `lib/index.js`（宿主）→ **必须手动重启 dsh web**（绝不要自己重启，用户手动执行）
- **GitHub 推送**：用一次性 Basic auth 避免 token 落盘：
  ```powershell
  $b64 = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("534119219:<PAT>"))
  git -c http.extraheader="Authorization: Basic $b64" push origin main
  ```
  PAT：`<PAT>`（占位符；真实 PAT 已多次出现在聊天记录中，**务必轮换**；git config 里无 token；**不要把真实 PAT 写进任何仓库文件，GitHub Secret Scanning 会拦截推送**）

## 三、架构要点

### 数据存储（v2 store，`~/.dsh/vault/store.json`）
```jsonc
{
  "version": 2, "setup": true,
  "wrapPw": {"salt","iv","ct"},   // K 被主密码派生密钥包裹（PBKDF2-SHA256）
  "wrapSec": {"salt","iv","ct"},  // K 被安全词派生密钥包裹
  "webdav": {"iv","ct"} | null,   // WebDAV 配置用 K 加密
  "records": [ // 非私密明文；私密仅存 enc
    {"id","name","category","tags","createdAt","updatedAt","private":false,"content":"明文"}
    | {"id",...,"private":true,"content":null,"enc":{"iv","ct"}}
  ],
  "autoDetect": true, "autoLockMinutes": 10,
  "meta": {"createdAt","updatedAt"}
}
```
- **加密**：浏览器 WebCrypto。随机 32B 保险箱密钥 K；K 分别被主密码/安全词派生密钥（PBKDF2-SHA256，标准 150000 轮，16B 盐）包裹；私密记录内容 + WebDAV 配置用 K 做 AES-256-GCM；非私密记录明文。
- **安全语义**：打开面板**免密码**（非私密可见）；点私密记录/编辑私密/用 WebDAV 配置时才验证主密码；**验证一次持续有效**，无操作超过 `autoLockMinutes`（默认 10 分钟，0=关闭）自动重新锁定；私密明文只存在于解锁后的内存（`runtime.privateById`）。

### 宿主端 `lib/index.js`
- 注入 `webServer` + `webRuntime`；监听 `ctx.on("session/event", ...)` 扫描会话文本
- 识别优先级：密钥(JWT/PEM/ghp_/sk-/带标签) → 网址 → SSH 服务器 → 手机号(**仅中国大陆**，`1[3-9]` 开头 11 位，可带 +86/86，归一化为裸 11 位，拒绝外国号/座机) → **IP（IPv4 + IPv6，已修复时间误判）** → 中文地址
- API（POST-only，fence 防跨站）：`status / loadStore / saveStore / saveConfig / suggestions / suggestAck / clearSuggestions / webdav(代理 PUT/GET/MKCOL，Basic auth，20s 超时，16MiB 上限)`
- **store 持久化用 `normalizeStore(raw, prev)`**：保留客户端 version、`records`/`autoLockMinutes` 完整往返，**合并式写入**（局部保存不清空已有字段）——这是修复过的历史 bug（白名单重建曾把 vault/records 全丢）
- 建议队列：MAX_PENDING=40，sha256 去重，`suggestions.json` 原子持久化

### 客户端 `lib/client.js`（约 2580 行，手写 bundle）
- **入口**：`apply(ctx)` 注册两处 slot：
  - `conversation.input.right`（order 90）→ `VaultTrigger`：按钮本体通过 **DOM 锚点**（`display:contents` span + MutationObserver）插到输入栏 trailing 行发送按钮正前方（slot 座位本身在模型选择器左侧，必须用锚点）→ 位于「用量」与「发送」之间
  - `settings.section`（order 80，label「便捷输入」）→ `SettingsSection`：设置移入 **DSH 设置页**（左侧栏 设置 → 便捷输入），导航图标用 DOM patch 换成闪电 ⚡
- **面板**（520px 宽，最高 min(90vh,780px)，右上角锚定发送按钮）：boot/error/setup/migrate/main 五相
  - 左侧分类栏：全部 → 消息 → 密钥 → 服务器 → 地址 → 手机号 → 网址 → 其他（动态计数）
  - 右侧记录列表：名称/分类/私密徽标(无图标) → 内容预览(锁定显示 ••••) → 标签行(无 #) → 创建时间行
  - 顶部：搜索(名称/标签/分类模糊) + 新增按钮 + 锁定按钮(解锁时)
  - 可收录 banner：**只显示 3 行** + 「还有 N 条 →」可点开完整列表弹窗(SuggestionsModal，逐条收录/忽略 + 全部忽略)；检测到新信息只红点脉冲不自动弹出
  - 锁定提示条在顶部（搜索栏下方）
- **填入**：`insertIntoComposer()` 读 textarea 光标/选区，插入内容（**追加到光标处不覆盖**），setDraft 后聚焦定位光标；成功后**自动关闭面板**；Ctrl+点击 = 插入 + submit 发送
- **设置页 SettingsBody**（自包含，不依赖面板）：自动识别 / 自动锁定 / WebDAV(加密配置，未解锁时先验证密码) / 修改密码(含安全词重置) 四个圆角卡片（bg-layer-3，与峰谷插件一致）
- **迁移**（v1→v2）：MigrateView 输入旧密码 → `migrateV1`（多 KDF 参数兼容矩阵 + vault 缺失按空库迁移 + 主密码包裹升级标准参数）；另有「忘记密码→安全词重置并迁移」和「重建空保险箱（vault 为空时，无需旧密钥）」两条兜底

## 四、关键历史 bug 与修复（勿回退）

1. **宿主白名单丢数据**：`loadStoreFiles/saveStore/loadStore` 曾用固定字段重建 store → `records`/`autoLockMinutes`/version 全丢、vault 变 null → 用户早期数据丢失。修复：`normalizeStore` 合并式写入。**当时用户磁盘上的旧数据（v1 vault）已不可恢复（vault:null）**；`suggestions.json` 曾有 5 条待收录可重新收录。
2. **迁移误报"密码错误"**：vault 为 null 时 `migrateV1` 访问 `store.vault.iv` 抛错被笼统显示为密码错。修复：vault 缺失按空库迁移。
3. **KDF 参数兼容**：为兼容早期版本可能的非标准 PBKDF2 参数，`unwrapWrappedKey` 依次尝试 11 种变体（迭代 150000/100000/600000/310000/200000/10000/1000 × SHA-256/512/1）+ 末尾空格容错。迁移后 wrapPw 升级为标准参数，wrapSec 保留原样（重置时走兼容路径）。
4. **时间误识别为服务器**：IPv6 正则 `(hex:){2,7}hex` 把 `07:44:23` 当 IPv6。修复：完整段至少 4 段 + `::` 简写形态专门匹配，`HH:MM:SS`/`HH:MM` 不再命中（已加测试）。**此改动在宿主端，需重启 dsh 生效**。
5. **按钮位置**：slot 座位在模型选择器左侧 → DOM 锚点插到发送按钮前。
6. **弹窗层级**：modal 层 zIndex 2147483200 + `.dsh-vault-modal-layer` 守卫（外层面板 Esc/外点不误关）。
7. **设置弹窗关闭无效/居中**：曾漏传 `onClose`；现设置已整体移入 DSH 设置页。

## 五、测试（4 套，全绿）

```bash
node test/matcher.test.mjs   # 模式识别（27 项：含时间不误判、IPv6、仅大陆手机号等）
node test/host.smoke.mjs     # 宿主 API + watcher + WebDAV 代理 + 合并写入保护（21 项）
node test/crypto.test.mjs    # v2 加密全链路（36 项：setup/unlock/lock/改密/安全词重置/v1迁移/空库迁移/KDF兼容）
node test/client.load.mjs    # 客户端 bundle 结构（6 项）
```
改代码后：`node --check lib/client.js && node --check lib/index.js` + 全量测试。

## 六、当前状态与数据

- Git：`8ab0268`（docs 更新交接摘要）已推送，工作区干净；死代码清理 `7f5f78e` 亦已推送
- 用户数据：`~/.dsh/vault/store.json` = **v2**，1 条私密记录（GitHub），enc 结构正常；vault 为空的历史问题已过
- `~/.dsh/vault/suggestions.json`：待收录队列（数量可变）
- 运行中的 dsh web 需注意：**上一轮宿主端改动（IPv6 修复）需用户重启 dsh web 后生效**

## 七、已知待办 / 可改进项

1. ✅ 已完成用户全部 12 轮反馈（位置/大小/免密/自动锁定/设置分区/设置移入设置页/收录 3 行/追加填入/关闭面板/分类/标签样式等）
2. ✅ 已完成（2026-08-17 清理）：VaultPanel 的 `setAutoDetect/setAutoLock/saveWebdav/doBackup/doRestore/doChangePw` 死代码已删除（`7f5f78e`，69 行）
3. ✅ 已完成（同上提交）：`useMemo`、`IconSettingsOutline16` 未用 import 已删除
4. **PAT 已多次出现在聊天记录，强烈建议用户轮换**
5. 潜在优化：`insertIntoComposer` 对 contenteditable 只做追加末尾（DSH 实际用 textarea，影响小）
6. 若 DSH 升级导致 slot 名/`settings.section` 渲染变化，需回归验证设置页分区

## 八、常用操作速查

- 提交推送：
  ```powershell
  cd D:\Harness\chicheng-vault
  git add -A; git commit -m "..."
  $b64 = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("534119219:<PAT>"))
  git -c http.extraheader="Authorization: Basic $b64" push origin main
  ```
- 重启 dsh：用户手动执行（`D:\Harness\restart-dsh-web.ps1` 或等价方式），**我不执行**
- 修改后生效：client → Ctrl+F5；host → 重启 dsh
