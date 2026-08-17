/**
 * chicheng-vault — client half
 *
 * 便捷输入保险箱 UI：
 *  - 在输入栏「用量」与「发送」之间注入一个灰色圆形按钮（与发送按钮同尺寸
 *    同圆角；slot 座位本身在模型选择器左侧，按钮本体通过 DOM 锚点插入到
 *    发送按钮正前方），点击展开带过渡动画的浮层面板；
 *  - 首次使用设置主密码 + 安全词；之后打开面板【不需要密码】——非私密记录
 *    直接可见；点击私密记录时才验证主密码，验证一次持续有效，无操作超过
 *    autoLockMinutes 后自动重新锁定私密内容（也可手动锁定）；
 *  - 数据安全（WebCrypto PBKDF2 + AES-GCM）：随机保险箱密钥 K 分别被主密码
 *    派生密钥与安全词派生密钥包裹；【私密记录内容】与【WebDAV 配置】用 K
 *    加密，非私密记录明文存放；密文全部交给宿主端持久化，私密明文只存在于
 *    解锁后的内存；
 *  - 面板：左侧分类栏 + 右侧记录列表，顶部全局搜索（名称/标签模糊匹配），
 *    右上角「新增」；每条记录可编辑/删除；点击记录填入输入框，Ctrl/⌘+点击
 *    直接发送；
 *  - 宿主端识别到会话中的密钥/网址/服务器/手机号等敏感信息后，按钮红点脉冲
 *    提示（不自动弹出），打开面板后在顶部逐条收录；
 *  - WebDAV 备份/恢复（经宿主端代理转发，规避 CORS）。
 *
 * 依赖：仅使用 shell 静态模块表中的 react / react-dom / primitives。
 */
window.__ModuleLoader__.load({
	id: "chicheng-vault",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		var React = require("react");
		var ReactDOM = require("react-dom");
		var primitives = require("@deepseek-ai/dsh-client-ui-primitives");

		var createElement = React.createElement;
		var useState = React.useState;
		var useEffect = React.useEffect;
		var useRef = React.useRef;
		var useCallback = React.useCallback;
		var useMemo = React.useMemo;
		var createPortal = ReactDOM.createPortal;

		var Button = primitives.Button;
		var IconSearchOutline16 = primitives.IconSearchOutline16;
		var IconPlusOutline16 = primitives.IconPlusOutline16;
		var IconSettingsOutline16 = primitives.IconSettingsOutline16;
		var IconEditOutline16 = primitives.IconEditOutline16;
		var IconTrashOutline16 = primitives.IconTrashOutline16;
		var IconCloseOutline16 = primitives.IconCloseOutline16;
		var IconRefreshOutline16 = primitives.IconRefreshOutline16;

		// ============================================================ i18n

		var NS = "chicheng-vault";

		function zhCopy() {
			return typeof document !== "undefined" && document.documentElement && document.documentElement.lang && document.documentElement.lang.toLowerCase().indexOf("zh") === 0;
		}

		var zh = {
			nav: "保险箱",
			password: "密码",
			unlock: "解锁",
			unlockFail: "密码不正确",
			forgot: "忘记密码？使用安全词重置",
			setupTitle: "首次使用 · 设置密码",
			setupDesc: "为保险箱设置主密码与安全词。安全词用于忘记密码时重置，请务必牢记并保密。",
			confirmPassword: "确认密码",
			securityWord: "安全词",
			securityWordDesc: "忘记密码时用它重置密码，请单独保管。",
			confirmSecurityWord: "确认安全词",
			passwordShort: "密码至少需要 4 个字符",
			securityShort: "安全词至少需要 2 个字符",
			passwordMismatch: "两次输入的密码不一致",
			securityMismatch: "两次输入的安全词不一致",
			create: "创建保险箱",
			setupDone: "保险箱创建成功",
			setupDoneDesc: "你的安全词是：",
			setupDoneWarn: "该安全词仅展示这一次，请务必抄写保存。忘记密码时，只有安全词可以重置。",
			start: "开始使用",
			migrateTitle: "迁移旧版本数据",
			migrateDesc: "检测到旧版本（v1）数据。输入原密码将其迁移到新格式。迁移后：打开面板不再需要密码，仅私密内容需要密码验证。",
			migrate: "迁移",
			migrateFail: "密码不正确，无法迁移",
			rebuildEmpty: "重建空保险箱（旧数据为空）",
			rebuildWarn: "当前保险箱没有任何数据（旧密文为空）。重建将放弃旧密码/安全词，创建全新的空保险箱，不丢失任何记录。",
			rebuild: "确认重建",
			resetTitle: "使用安全词重置",
			resetDesc: "输入安全词验证身份，然后设置新密码。",
			verify: "验证并重置",
			verifyFail: "安全词不正确",
			newPassword: "新密码",
			newSecurityWord: "新安全词（可留空保持不变）",
			searchPlaceholder: "搜索名称 / 标签…",
			add: "新增",
			all: "全部",
			noRecords: "暂无记录，点击右上角「新增」添加",
			noSearch: "未找到匹配的记录",
			privateBadge: "私密",
			createdAt: "创建于",
			filled: "已填入输入框",
			noInput: "输入区暂不可用",
			privateLockedHint: "🔒 私密内容已锁定 — 点击私密记录验证密码即可使用（验证一次持续有效，无操作自动锁定）",
			contentLocked: "该私密内容已锁定，验证密码后可查看并修改",
			needPwToSave: "保存私密记录需要先验证主密码",
			verifyPw: "验证密码",
			suggestTitle: "检测到 {n} 条可收录信息",
			suggestHint: "会话中出现以下敏感信息，是否收录到保险箱？",
			record: "收录",
			ignore: "忽略",
			ignoreAll: "全部忽略",
			more: "还有 {n} 条…",
			formAdd: "新增记录",
			formEdit: "编辑记录",
			formName: "名称",
			formContent: "内容",
			formCategory: "分类",
			formTags: "标签",
			formTagsHint: "多个标签用逗号分隔",
			formPrivate: "私密记录（查看需再次输入密码）",
			save: "保存",
			cancel: "取消",
			required: "名称和内容不能为空",
			confirmDelete: "确定删除记录「{name}」？",
			delete: "删除",
			privateTitle: "私密记录",
			privateDesc: "查看或使用这条私密记录需要输入主密码。验证一次后，本次会话内所有私密记录均可用。",
			settings: "设置",
			settingsNav: "便捷输入",
			settingsHint: "保险箱设置：数据在浏览器内加密，私密明文只存在于解锁后的内存。可配置自动识别、自动锁定与 WebDAV 备份；私密记录点击验证一次后持续有效，无操作自动锁定。",
			secAutoDetect: "自动识别",
			autoDetectDesc: "识别会话中的密钥、网址、服务器、手机号、IP、地址等，按钮红点提示是否收录。",
			secAutoLock: "自动锁定",
			secAutoLockDesc: "无操作超过设定时长后，私密内容自动重新锁定（0 = 关闭自动锁定）。",
			webdav: "WebDAV 备份",
			webdavDesc: "将保险箱备份到 WebDAV（如坚果云）。备份文件包含加密内容，恢复后需重新解锁私密内容。",
			webdavLocked: "WebDAV 配置已加密，验证主密码后使用。",
			webdavUrl: "WebDAV 地址",
			webdavUser: "用户名",
			webdavPass: "密码",
			webdavSaved: "WebDAV 配置已保存",
			webdavUrlRequired: "请先填写 WebDAV 地址",
			backup: "立即备份",
			backupName: "备份文件名（可自定义）",
			backupOk: "备份成功",
			backupFail: "备份失败",
			restore: "从备份恢复",
			restoreHint: "文件名默认为 chicheng-vault-backup.json",
			restoreOk: "已恢复备份",
			restoredNote: "已恢复备份。私密内容已锁定，请重新解锁查看。",
			restoreFail: "恢复失败",
			restoreConfirm: "恢复将覆盖当前保险箱数据，确定继续？",
			changePw: "修改密码",
			changePwDesc: "验证当前密码后设置新密码。",
			currentPw: "当前密码",
			confirmNewPw: "确认新密码",
			pwChanged: "密码已修改",
			changeFail: "当前密码不正确",
			change: "修改",
			autoLock: "自动锁定（分钟，0 = 关闭）",
			lockNow: "锁定",
			autoLocked: "长时间无操作，私密内容已自动锁定",
			loading: "加载中…",
			loadFail: "保险箱加载失败",
			retry: "重试",
		};

		var en = {
			nav: "Vault",
			password: "Password",
			unlock: "Unlock",
			unlockFail: "Incorrect password",
			forgot: "Forgot password? Reset with security word",
			setupTitle: "First run · Set up password",
			setupDesc: "Choose a master password and a security word. The security word resets a forgotten password — keep it secret and safe.",
			confirmPassword: "Confirm password",
			securityWord: "Security word",
			securityWordDesc: "Used to reset the password when forgotten.",
			confirmSecurityWord: "Confirm security word",
			passwordShort: "Password needs at least 4 characters",
			securityShort: "Security word needs at least 2 characters",
			passwordMismatch: "Passwords do not match",
			securityMismatch: "Security words do not match",
			create: "Create vault",
			setupDone: "Vault created",
			setupDoneDesc: "Your security word is:",
			setupDoneWarn: "This is shown only once — write it down. Only the security word can reset a forgotten password.",
			start: "Get started",
			migrateTitle: "Migrate old data",
			migrateDesc: "Legacy (v1) data detected. Enter your old password to migrate to the new format. After migration, opening the panel needs no password — only private content requires the password.",
			migrate: "Migrate",
			migrateFail: "Incorrect password — cannot migrate",
			rebuildEmpty: "Rebuild empty vault (no old data)",
			rebuildWarn: "The current vault holds no data (old ciphertext is empty). Rebuilding discards the old password/security word and creates a fresh empty vault — no records are lost.",
			rebuild: "Rebuild",
			resetTitle: "Reset with security word",
			resetDesc: "Verify with your security word, then set a new password.",
			verify: "Verify & reset",
			verifyFail: "Incorrect security word",
			newPassword: "New password",
			newSecurityWord: "New security word (leave empty to keep)",
			searchPlaceholder: "Search name / tags…",
			add: "New",
			all: "All",
			noRecords: "No records yet — use the New button above",
			noSearch: "No matching records",
			privateBadge: "Private",
			createdAt: "Created",
			filled: "Filled into the input",
			noInput: "Input area unavailable",
			privateLockedHint: "🔒 Private content is locked — click a private record and verify the password to use it (stays valid until idle auto-lock)",
			contentLocked: "This private content is locked — verify the password to view and edit",
			needPwToSave: "Verify the master password to save a private record",
			verifyPw: "Verify password",
			suggestTitle: "{n} item(s) detected",
			suggestHint: "Sensitive info found in the conversation — save it to the vault?",
			record: "Save",
			ignore: "Ignore",
			ignoreAll: "Ignore all",
			more: "{n} more…",
			formAdd: "New record",
			formEdit: "Edit record",
			formName: "Name",
			formContent: "Content",
			formCategory: "Category",
			formTags: "Tags",
			formTagsHint: "Separate tags with commas",
			formPrivate: "Private record (requires the password to view)",
			save: "Save",
			cancel: "Cancel",
			required: "Name and content are required",
			confirmDelete: "Delete record \"{name}\"?",
			delete: "Delete",
			privateTitle: "Private record",
			privateDesc: "Enter the master password to view or use this private record. Once verified, all private records stay available until idle auto-lock.",
			settings: "Settings",
			settingsNav: "Quick Input",
			settingsHint: "Vault settings: data is encrypted in the browser; private plaintext lives only in unlocked memory. Configure auto-detect, auto-lock and WebDAV backup; private records verify once and stay valid until idle auto-lock.",
			secAutoDetect: "Auto-detect",
			autoDetectDesc: "Detects keys, URLs, servers, phones, IPs, addresses in conversations and pulses the button as a reminder.",
			secAutoLock: "Auto-lock",
			secAutoLockDesc: "Private content re-locks after this many minutes without activity (0 = never).",
			webdav: "WebDAV backup",
			webdavDesc: "Back up the vault to WebDAV (e.g. Nutstore). The backup holds encrypted data; unlock again after restore.",
			webdavLocked: "The WebDAV config is encrypted — verify the master password to use it.",
			webdavUrl: "WebDAV URL",
			webdavUser: "Username",
			webdavPass: "Password",
			webdavSaved: "WebDAV config saved",
			webdavUrlRequired: "Enter the WebDAV URL first",
			backup: "Back up now",
			backupName: "Backup file name (customizable)",
			backupOk: "Backup succeeded",
			backupFail: "Backup failed",
			restore: "Restore from backup",
			restoreHint: "Default file name: chicheng-vault-backup.json",
			restoreOk: "Backup restored",
			restoredNote: "Backup restored. Private content is locked — unlock again to view.",
			restoreFail: "Restore failed",
			restoreConfirm: "Restoring overwrites the current vault. Continue?",
			changePw: "Change password",
			changePwDesc: "Verify the current password, then set a new one.",
			currentPw: "Current password",
			confirmNewPw: "Confirm new password",
			pwChanged: "Password changed",
			changeFail: "Current password is incorrect",
			change: "Change",
			autoLock: "Auto-lock (minutes, 0 = off)",
			lockNow: "Lock",
			autoLocked: "Idle for too long — private content re-locked",
			loading: "Loading…",
			loadFail: "Failed to load vault",
			retry: "Retry",
		};

		function t(key, params) {
			var dict = zhCopy() ? zh : en;
			var text = dict[key] !== undefined ? dict[key] : key;
			if (params) {
				text = String(text).replace(/\{(\w+)\}/g, function (_, k) {
					return params[k] !== undefined ? String(params[k]) : "{" + k + "}";
				});
			}
			return text;
		}

		// ============================================================ api

		async function api(method, payload) {
			var response = await fetch("/vault/api/" + method, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(payload || {}),
				credentials: "same-origin",
			});
			var parsed = await response.json().catch(function () { return null; });
			if (!response.ok || parsed === null || parsed.ok !== true) {
				var err = new Error(parsed && parsed.error && parsed.error.message ? parsed.error.message : "HTTP " + response.status);
				err.code = parsed && parsed.error && parsed.error.code ? parsed.error.code : "api-error";
				throw err;
			}
			return parsed.value;
		}

		// ============================================================ styles

		function ensureStyleEl() {
			var existing = document.getElementById("dsh-vault-style");
			if (existing) return existing;
			var style = document.createElement("style");
			style.id = "dsh-vault-style";
			style.textContent = [
				"@keyframes dsh-vault-pop{from{opacity:0;transform:translateY(10px) scale(.97)}to{opacity:1;transform:translateY(0) scale(1)}}",
				"@keyframes dsh-vault-pop-out{from{opacity:1;transform:translateY(0) scale(1)}to{opacity:0;transform:translateY(8px) scale(.98)}}",
				"@keyframes dsh-vault-fade{from{opacity:0}to{opacity:1}}",
				"@keyframes dsh-vault-ping{0%{box-shadow:0 0 0 0 rgba(239,68,68,.6)}70%{box-shadow:0 0 0 6px rgba(239,68,68,0)}100%{box-shadow:0 0 0 0 rgba(239,68,68,0)}}",
				".dsh-vault-btn{background:var(--dsw-alias-bg-layer-3)!important;color:var(--dsw-alias-label-secondary)!important;border:1px solid var(--dsw-alias-border-l2)!important}",
				".dsh-vault-btn:hover{background:var(--dsw-alias-interactive-bg-hover)!important;color:var(--dsw-alias-label-primary)!important}",
				".dsh-vault-btn:active{transform:translateY(-2px) scale(.92)!important}",
				".dsh-vault-panel{animation:dsh-vault-pop .18s cubic-bezier(.2,.8,.2,1)}",
				".dsh-vault-panel-closing{animation:dsh-vault-pop-out .14s ease forwards}",
				".dsh-vault-fade{animation:dsh-vault-fade .15s ease}",
				".dsh-vault-mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,'Courier New',monospace}",
				".dsh-vault-scroll::-webkit-scrollbar{width:8px;height:8px}",
				".dsh-vault-scroll::-webkit-scrollbar-thumb{background:var(--dsw-alias-scrollbar-bg-l2,#00000033);border-radius:999px}",
				".dsh-vault-scroll::-webkit-scrollbar-thumb:hover{background:var(--dsw-alias-scrollbar-hover-l2,#00000055)}",
				".dsh-vault-scroll{scrollbar-width:thin;scrollbar-color:var(--dsw-alias-scrollbar-bg-l2,#00000033) transparent}",
			].join("\n");
			document.head.appendChild(style);
			return style;
		}

		var panelStyle = {
			position: "fixed",
			zIndex: 2147483000,
			width: 520,
			maxWidth: "calc(100vw - 16px)",
			maxHeight: "min(90vh, 780px)",
			display: "flex",
			flexDirection: "column",
			boxSizing: "border-box",
			border: "1px solid var(--dsw-alias-border-l2)",
			background: "var(--dsw-alias-bg-layer-3)",
			borderRadius: "16px",
			boxShadow: "0 12px 40px rgba(0,0,0,.28), 0 2px 8px rgba(0,0,0,.18)",
			overflow: "hidden",
		};
		var overlayStyle = {
			position: "fixed",
			inset: 0,
			zIndex: 2147483200,
			background: "rgba(0,0,0,.32)",
			display: "flex",
			alignItems: "center",
			justifyContent: "center",
		};
		var modalCardStyle = {
			boxSizing: "border-box",
			width: 420,
			maxWidth: "calc(100vw - 24px)",
			maxHeight: "min(82vh, 640px)",
			overflowY: "auto",
			border: "1px solid var(--dsw-alias-border-l2)",
			background: "var(--dsw-alias-bg-layer-3)",
			borderRadius: "16px",
			boxShadow: "0 16px 48px rgba(0,0,0,.35)",
			padding: "18px",
			display: "flex",
			flexDirection: "column",
			gap: "12px",
		};
		var inputStyle = {
			width: "100%",
			boxSizing: "border-box",
			padding: "8px 10px",
			borderRadius: "9px",
			border: "1px solid var(--dsw-alias-border-l2)",
			background: "var(--dsw-alias-bg-layer-2)",
			color: "var(--dsw-alias-label-primary)",
			fontSize: 13,
			outline: "none",
			fontFamily: "inherit",
		};
		var textareaStyle = Object.assign({}, inputStyle, { minHeight: "84px", resize: "vertical", lineHeight: 1.55 });
		var labelStyle = { fontSize: 12, fontWeight: 600, color: "var(--dsw-alias-label-secondary)", display: "flex", flexDirection: "column", gap: 5 };
		var hintStyle = { fontSize: 11, color: "var(--dsw-alias-label-tertiary)", lineHeight: 1.5 };
		var primaryText = { color: "var(--dsw-alias-label-primary)" };
		var secondaryText = { color: "var(--dsw-alias-label-secondary)" };
		var tertiaryText = { color: "var(--dsw-alias-label-tertiary)" };
		var okText = { color: "var(--dsw-alias-state-success-primary)" };
		var errText = { color: "var(--dsw-alias-state-error-primary)" };
		var chipStyle = {
			display: "inline-flex",
			alignItems: "center",
			gap: 4,
			borderRadius: 999,
			padding: "1px 8px",
			fontSize: 11,
			fontWeight: 600,
			lineHeight: "18px",
			flex: "none",
			background: "var(--dsw-alias-interactive-bg-hover)",
			color: "var(--dsw-alias-label-secondary)",
		};
		var iconBtnStyle = {
			display: "inline-flex",
			alignItems: "center",
			justifyContent: "center",
			width: 26,
			height: 26,
			borderRadius: 7,
			border: "none",
			background: "transparent",
			color: "var(--dsw-alias-label-tertiary)",
			cursor: "pointer",
			flex: "none",
			padding: 0,
		};
		var sectionStyle = {
			border: "1px solid var(--dsw-alias-border-l2)",
			borderRadius: 14,
			background: "var(--dsw-alias-bg-layer-3)",
			padding: "14px 16px",
			display: "flex",
			flexDirection: "column",
			gap: 10,
			flex: "none",
		};
		var sectionTitleStyle = { fontSize: 13, fontWeight: 700, color: "var(--dsw-alias-label-primary)" };
		var sectionDescStyle = { fontSize: 11, color: "var(--dsw-alias-label-tertiary)", lineHeight: 1.6 };

		// ============================================================ crypto

		var enc = new TextEncoder();
		var dec = new TextDecoder();
		var PBKDF2_ITERATIONS = 150000;
		var STORE_VERSION = 2;

		function b64e(buf) {
			var bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
			var bin = "";
			for (var i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
			return btoa(bin);
		}

		function b64d(str) {
			var bin = atob(str);
			var bytes = new Uint8Array(bin.length);
			for (var i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
			return bytes;
		}

		// 历史版本可能使用过的 KDF 参数（按可能性排序；第 1 项即当前标准）。
		// 迁移/解锁/重置时依次尝试，保证早期创建的 store 在参数变化后仍可解开。
		var PBKDF2_VARIANTS = [
			{ iterations: PBKDF2_ITERATIONS, hash: "SHA-256" }, // 当前标准：150000/SHA-256
			{ iterations: 100000, hash: "SHA-256" },
			{ iterations: 600000, hash: "SHA-256" },
			{ iterations: 310000, hash: "SHA-256" },
			{ iterations: 200000, hash: "SHA-256" },
			{ iterations: 10000, hash: "SHA-256" },
			{ iterations: 1000, hash: "SHA-256" },
			{ iterations: PBKDF2_ITERATIONS, hash: "SHA-512" },
			{ iterations: 100000, hash: "SHA-512" },
			{ iterations: PBKDF2_ITERATIONS, hash: "SHA-1" },
			{ iterations: 100000, hash: "SHA-1" },
		];

		async function deriveKey(password, saltB64, iterations, hash) {
			var salt = b64d(saltB64);
			var base = await crypto.subtle.importKey("raw", enc.encode(String(password)), "PBKDF2", false, ["deriveKey"]);
			return crypto.subtle.deriveKey(
				{ name: "PBKDF2", salt: salt, iterations: iterations || PBKDF2_ITERATIONS, hash: hash || "SHA-256" },
				base,
				{ name: "AES-GCM", length: 256 },
				false,
				["encrypt", "decrypt"]
			);
		}

		/** 用口令解开被包裹的 K（wrapPw / wrapSec）：依次尝试各历史 KDF 参数，兼容旧版本数据。 */
		async function unwrapWrappedKey(store, password, which) {
			var wrap = which === "wrapSec" ? store.wrapSec : store.wrapPw;
			if (!wrap || !wrap.salt || !wrap.iv || !wrap.ct) throw new Error("no-wrap");
			var lastErr = null;
			var tryOne = async function (pwText, variant) {
				var pwKey = await deriveKey(pwText, wrap.salt, variant.iterations, variant.hash);
				return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64d(wrap.iv) }, pwKey, b64d(wrap.ct)));
			};
			for (var i = 0; i < PBKDF2_VARIANTS.length; i += 1) {
				try { return { K: await tryOne(password, PBKDF2_VARIANTS[i]), variant: PBKDF2_VARIANTS[i], trimmed: false }; }
				catch (e) { lastErr = e; }
			}
			// 中文输入法常见：末尾误带空格
			var trimmed = String(password).replace(/[ \t]+$/, "");
			if (trimmed !== String(password)) {
				for (var j = 0; j < PBKDF2_VARIANTS.length; j += 1) {
					try { return { K: await tryOne(trimmed, PBKDF2_VARIANTS[j]), variant: PBKDF2_VARIANTS[j], trimmed: true }; }
					catch (e) { lastErr = e; }
				}
			}
			throw lastErr || new Error("bad-password");
		}

		async function deriveKeyWithSalt(password) {
			var salt = crypto.getRandomValues(new Uint8Array(16));
			var key = await deriveKey(password, b64e(salt), PBKDF2_ITERATIONS);
			return { key: key, salt: b64e(salt) };
		}

		async function importVaultKey(rawBytes) {
			return crypto.subtle.importKey("raw", rawBytes, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
		}

		async function aesEncrypt(key, dataBytes) {
			var iv = crypto.getRandomValues(new Uint8Array(12));
			var ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv }, key, dataBytes);
			return { iv: b64e(iv), ct: b64e(ct) };
		}

		async function aesDecrypt(key, ivB64, ctB64) {
			var raw = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64d(ivB64) }, key, b64d(ctB64));
			return new Uint8Array(raw);
		}

		function uuid() {
			try {
				if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
			} catch (e) { /* fall through */ }
			return "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
		}

		function emptyStore() {
			var now = new Date().toISOString();
			return {
				version: STORE_VERSION,
				setup: true,
				wrapPw: null,
				wrapSec: null,
				webdav: null,
				records: [],
				autoDetect: true,
				autoLockMinutes: 10,
				meta: { createdAt: now, updatedAt: now },
			};
		}

		/** 用 K 解密私密记录内容与 WebDAV 配置并写入运行时（解锁态）。 */
		async function activateKey(kKey) {
			var store = runtime.store;
			var privateById = {};
			var list = store && store.records ? store.records : [];
			for (var i = 0; i < list.length; i += 1) {
				var r = list[i];
				if (r.private === true && r.enc) {
					try {
						privateById[r.id] = dec.decode(await aesDecrypt(kKey, r.enc.iv, r.enc.ct));
						try { console.log("[vault:key] decrypted", r.id, "len=" + privateById[r.id].length); } catch (e) { /* ignore */ }
					} catch (e) {
						privateById[r.id] = "";
						try { console.warn("[vault:key] decrypt FAILED", r.id); } catch (err) { /* ignore */ }
					}
				}
			}
			var webdav = null;
			if (store && store.webdav) {
				try { webdav = JSON.parse(dec.decode(await aesDecrypt(kKey, store.webdav.iv, store.webdav.ct))); } catch (e) { webdav = null; }
			}
			runtime.key = kKey;
			runtime.privateById = privateById;
			runtime.webdav = webdav;
		}

		async function saveStoreToHost() {
			if (!runtime.store) return;
			runtime.store.meta = Object.assign({}, runtime.store.meta || {}, { updatedAt: new Date().toISOString() });
			await api("saveStore", { store: runtime.store });
		}

		async function setupVault(password, securityWord) {
			var K = crypto.getRandomValues(new Uint8Array(32));
			var kKey = await importVaultKey(K);
			var pw = await deriveKeyWithSalt(password);
			var sec = await deriveKeyWithSalt(securityWord);
			var store = emptyStore();
			store.wrapPw = Object.assign({ salt: pw.salt }, await aesEncrypt(pw.key, K));
			store.wrapSec = Object.assign({ salt: sec.salt }, await aesEncrypt(sec.key, K));
			await api("saveStore", { store: store });
			runtime.store = store;
			runtime.key = kKey;
			runtime.privateById = {};
			runtime.webdav = null;
			return store;
		}

		/** 用主密码解锁：解出 K 并解密私密内容 + WebDAV 配置；失败抛错。 */
		async function unlockVault(password) {
			var store = runtime.store;
			if (!store || !store.wrapPw) throw new Error("not-setup");
			var unwrapped = await unwrapWrappedKey(store, password, "wrapPw");
			var kKey = await importVaultKey(unwrapped.K);
			await activateKey(kKey);
			return true;
		}

		async function verifyPassword(password) {
			try {
				await unlockVault(password);
				return true;
			} catch (e) {
				return false;
			}
		}

		async function resetWithSecurityWord(securityWord, newPassword, newSecurityWord) {
			var store = runtime.store;
			if (!store || !store.wrapSec) throw new Error("no-security-word");
			var unwrapped = await unwrapWrappedKey(store, securityWord, "wrapSec");
			var kKey = await importVaultKey(unwrapped.K);
			var pw = await deriveKeyWithSalt(newPassword);
			store.wrapPw = Object.assign({ salt: pw.salt }, await aesEncrypt(pw.key, unwrapped.K));
			if (newSecurityWord) {
				var sec2 = await deriveKeyWithSalt(newSecurityWord);
				store.wrapSec = Object.assign({ salt: sec2.salt }, await aesEncrypt(sec2.key, unwrapped.K));
			}
			await saveStoreToHost();
			await activateKey(kKey);
			return true;
		}

		async function changePassword(currentPassword, newPassword) {
			var store = runtime.store;
			if (!store || !store.wrapPw) throw new Error("not-setup");
			var unwrapped = await unwrapWrappedKey(store, currentPassword, "wrapPw");
			var pw2 = await deriveKeyWithSalt(newPassword);
			store.wrapPw = Object.assign({ salt: pw2.salt }, await aesEncrypt(pw2.key, unwrapped.K));
			await saveStoreToHost();
		}

		/** v1 → v2 迁移：解开旧 K（兼容历史 KDF 参数），私密记录改存 enc、非私密改明文，
		 *  并把主密码包裹升级为当前标准 KDF（新盐 + 150000/SHA-256），安全词包裹保留原样
		 *  （重置时自动走参数兼容路径）。vault 密文缺失/为空时按空库迁移。 */
		async function migrateV1(password) {
			var store = runtime.store;
			if (!store || !store.wrapPw) throw new Error("not-v1");
			var unwrapped = await unwrapWrappedKey(store, password, "wrapPw");
			var kKey = await importVaultKey(unwrapped.K);
			try {
				console.info("[chicheng-vault] migrated with KDF " + unwrapped.variant.iterations + "/" + unwrapped.variant.hash + (unwrapped.trimmed ? " (password had trailing space)" : ""));
			} catch (e) { /* ignore */ }
			var vaultObj = null;
			if (store.vault && store.vault.iv && store.vault.ct) {
				try { vaultObj = JSON.parse(dec.decode(await aesDecrypt(kKey, store.vault.iv, store.vault.ct))); } catch (e) { vaultObj = null; }
			}
			if (!vaultObj) {
				try { console.warn("[chicheng-vault] v1 store has no usable vault blob — migrating as an empty vault"); } catch (e) { /* ignore */ }
				vaultObj = { version: 1, records: [], webdav: null, autoLockMinutes: 10 };
			}
			var vaultObj = JSON.parse(dec.decode(await aesDecrypt(kKey, store.vault.iv, store.vault.ct)));
			var now = new Date().toISOString();
			// 主密码包裹升级为当前标准参数（新盐 + 150000/SHA-256），之后日常解锁走标准路径
			var pw = await deriveKeyWithSalt(password);
			var v2 = {
				version: STORE_VERSION,
				setup: true,
				wrapPw: Object.assign({ salt: pw.salt }, await aesEncrypt(pw.key, unwrapped.K)),
				wrapSec: store.wrapSec || null,
				webdav: null,
				records: [],
				autoDetect: store.autoDetect !== false,
				autoLockMinutes: Number(vaultObj.autoLockMinutes) > 0 ? Number(vaultObj.autoLockMinutes) : 10,
				meta: Object.assign({}, store.meta || {}, { updatedAt: now }),
			};
			if (vaultObj.webdav) v2.webdav = await aesEncrypt(kKey, enc.encode(JSON.stringify(vaultObj.webdav)));
			var list = Array.isArray(vaultObj.records) ? vaultObj.records : [];
			for (var i = 0; i < list.length; i += 1) {
				var r = list[i];
				var base = {
					id: r.id || uuid(),
					name: String(r.name || ""),
					category: String(r.category || "其他").trim() || "其他",
					tags: Array.isArray(r.tags) ? r.tags : [],
					createdAt: r.createdAt || now,
					updatedAt: r.updatedAt || now,
				};
				// 兼容旧版可能使用的字段名
				var isPrivate = r.private === true || r.isPrivate === true || r.secret === true;
				if (isPrivate) {
					v2.records.push(Object.assign({}, base, { private: true, content: null, enc: await aesEncrypt(kKey, enc.encode(String(r.content || ""))) }));
				} else {
					v2.records.push(Object.assign({}, base, { private: false, content: String(r.content || "") }));
				}
			}
			await api("saveStore", { store: v2 });
			runtime.store = v2;
			await activateKey(kKey);
			return true;
		}

		function lockVault(msg) {
			runtime.key = null;
			runtime.privateById = null;
			runtime.webdav = null;
			runtime.emit("locked", msg || null);
		}

		async function recordEncrypt(key, text) {
			return aesEncrypt(key, enc.encode(String(text || "")));
		}

		// ============================================================ runtime / bus

		var runtime = {
			store: null,
			key: null,
			privateById: null,
			webdav: null,
			status: null,
			seenIds: new Set(),
			timer: null,
			started: false,
			listeners: {},
			on: function (event, fn) {
				(runtime.listeners[event] = runtime.listeners[event] || []).push(fn);
				return function () {
					runtime.listeners[event] = (runtime.listeners[event] || []).filter(function (f) { return f !== fn; });
				};
			},
			emit: function (event, payload) {
				var fns = (runtime.listeners[event] || []).slice();
				for (var i = 0; i < fns.length; i += 1) {
					try { fns[i](payload); } catch (e) { /* listener must not break the loop */ }
				}
			},
		};

		function startPolling() {
			if (runtime.started) return;
			runtime.started = true;
			var tick = function () {
				if (!runtime.started) return;
				api("status").then(function (s) {
					runtime.status = s;
					runtime.emit("status", s);
				}).catch(function () { /* host may be warming up */ });
				api("suggestions").then(function (v) {
					var items = (v && v.items) || [];
					var fresh = items.filter(function (it) { return !runtime.seenIds.has(it.id); });
					runtime.seenIds = new Set(items.map(function (it) { return it.id; }));
					runtime.emit("suggestions", items);
					if (fresh.length > 0) runtime.emit("suggestions-new", fresh);
				}).catch(function () { /* ignore */ });
				runtime.timer = setTimeout(tick, 4000);
			};
			runtime.timer = setTimeout(tick, 2500);
		}

		function stopPolling() {
			runtime.started = false;
			if (runtime.timer !== null) { clearTimeout(runtime.timer); runtime.timer = null; }
		}

		// ============================================================ helpers

		function fmtTime(iso) {
			if (!iso) return "";
			var d = new Date(iso);
			if (isNaN(d.getTime())) return "";
			var p = function (n) { return String(n).padStart(2, "0"); };
			return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
		}

		function parseTags(text) {
			var out = [];
			String(text || "").split(/[,，;；\s]+/).forEach(function (tag) {
				tag = String(tag).trim();
				if (tag === "" || out.indexOf(tag) !== -1) return;
				if (out.length < 12) out.push(tag);
			});
			return out;
		}

		function DEFAULT_CATS() {
			return ["消息", "密钥", "服务器", "地址", "手机号", "网址", "其他"];
		}

		function categoriesOf(records) {
			var counts = {};
			var defaults = DEFAULT_CATS();
			defaults.forEach(function (c) { counts[c] = 0; });
			(records || []).forEach(function (r) {
				var c = String(r.category || "其他").trim() || "其他";
				counts[c] = (counts[c] || 0) + 1;
			});
			var out = [];
			defaults.forEach(function (c) { if (counts[c] !== undefined) out.push({ name: c, count: counts[c] }); });
			Object.keys(counts).forEach(function (c) {
				if (out.every(function (o) { return o.name !== c; })) out.push({ name: c, count: counts[c] });
			});
			return out;
		}

		/** 记录视图：私密记录解锁后 content 为解密明文，锁定中为 null。 */
		function recordsView(store) {
			var records = (store && store.records) || [];
			var unlocked = !!runtime.key;
			return records.map(function (r) {
				var base = {
					id: r.id,
					name: r.name,
					category: r.category || "其他",
					tags: r.tags || [],
					createdAt: r.createdAt,
					updatedAt: r.updatedAt,
				};
				if (r.private === true) {
					return Object.assign({}, base, {
						private: true,
						content: unlocked && runtime.privateById ? (runtime.privateById[r.id] || "") : null,
						locked: !unlocked,
					});
				}
				return Object.assign({}, base, { private: false, content: String(r.content || ""), locked: false });
			});
		}

		function focusComposer() {
			try {
				var el = document.querySelector('main textarea, main [contenteditable="true"], textarea');
				if (el && typeof el.focus === "function") el.focus();
			} catch (e) { /* ignore */ }
		}

		/** 读取 composer 当前内容与光标位置（textarea 优先，contenteditable 兜底）。 */
		function readComposerState() {
			try {
				var el = document.querySelector('main textarea, main [contenteditable="true"], textarea');
				if (!el) return { el: null, draft: "", start: 0, end: 0 };
				if (typeof el.value === "string") {
					var draft = el.value;
					var start = el.selectionStart != null ? el.selectionStart : draft.length;
					var end = el.selectionEnd != null ? el.selectionEnd : start;
					return { el: el, draft: draft, start: start, end: end };
				}
				var text = el.textContent || "";
				return { el: el, draft: text, start: text.length, end: text.length };
			} catch (e) {
				return { el: null, draft: "", start: 0, end: 0 };
			}
		}

		/** 把内容插入到 composer 当前光标处（有选区则替换选区），不覆盖已有文字；返回新 draft。 */
		function insertIntoComposer(actions, content) {
			var info = readComposerState();
			var start = info.start;
			var end = info.end;
			if (start < 0 || start > info.draft.length) start = info.draft.length;
			if (end < start || end > info.draft.length) end = start;
			var next = info.draft.slice(0, start) + content + info.draft.slice(end);
			if (typeof actions.setDraft === "function") actions.setDraft(next);
			// 聚焦并把光标定位到插入内容之后
			if (info.el && typeof info.el.focus === "function") {
				info.el.focus();
				if (typeof info.el.setSelectionRange === "function") {
					setTimeout(function () {
						try { info.el.setSelectionRange(start + content.length, start + content.length); } catch (err) { /* ignore */ }
					}, 0);
				}
			}
			return next;
		}

		function KeyIcon(props) {
			return createElement("svg", { viewBox: "0 0 16 16", width: props.size || 16, height: props.size || 16, fill: "none", stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "round", "aria-hidden": true },
				createElement("circle", { cx: 6, cy: 9.5, r: 3.2 }),
				createElement("path", { d: "M8.6 6.9 13.2 2.3" }),
				createElement("path", { d: "M10.8 4.1l1.9 1.9" })
			);
		}

		function LockIcon(props) {
			return createElement("svg", { viewBox: "0 0 16 16", width: props.size || 14, height: props.size || 14, fill: "currentColor", "aria-hidden": true },
				createElement("rect", { x: 4, y: 7, width: 8, height: 6.4, rx: 1.6 }),
				createElement("path", { d: "M6 7V5.6a2 2 0 0 1 4 0V7" })
			);
		}

		// ============================================================ small atoms

		function Field(props) {
			return createElement("label", { style: labelStyle },
				props.label ? createElement("span", { style: { fontWeight: 600, color: "var(--dsw-alias-label-primary)" } }, props.label) : null,
				props.children,
				props.hint ? createElement("span", { style: hintStyle }, props.hint) : null
			);
		}

		function PasswordInput(props) {
			return createElement("input", {
				type: "password",
				value: props.value,
				placeholder: props.placeholder || "",
				onChange: function (e) { props.onChange(e.target.value); },
				onKeyDown: props.onEnter ? function (e) { if (e.key === "Enter") props.onEnter(); } : undefined,
				style: inputStyle,
				autoFocus: props.autoFocus !== false,
				spellCheck: false,
			});
		}

		function ModalShell(props) {
			var overlay = Object.assign({}, overlayStyle);
			if (props.topAlign === true) {
				overlay.alignItems = "flex-start";
				overlay.paddingTop = "7vh";
			}
			var card = Object.assign({}, modalCardStyle);
			if (props.width) card.width = props.width;
			var shell = createElement("div", { style: overlay, className: "dsh-vault-fade dsh-vault-modal-layer", onMouseDown: props.onBackdrop },
				createElement("div", { style: card, onMouseDown: function (e) { e.stopPropagation(); } },
					createElement("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flex: "none" } },
						createElement("div", { style: { fontSize: 15, fontWeight: 700, color: "var(--dsw-alias-label-primary)" } }, props.title),
						createElement("button", { type: "button", onClick: props.onClose, style: iconBtnStyle, "aria-label": t("cancel") },
							createElement(IconCloseOutline16, { size: 14 }))
					),
					props.children
				)
			);
			return createPortal(shell, document.body);
		}

		// ============================================================ main panel

		var DEFAULT_POS = { right: 16, bottom: 96 };

		function VaultTrigger(props) {
			var inputActions = props.inputActions;
			var btnRef = useRef(null);
			var panelRef = useRef(null);
			var [open, setOpen] = useState(false);
			var [closing, setClosing] = useState(false);
			var [pos, setPos] = useState(DEFAULT_POS);
			var [suggestions, setSuggestions] = useState([]);
			var [status, setStatus] = useState(null);
			// 新建议到达时仅让红点脉冲一次，不自动展开面板
			var [pulse, setPulse] = useState(0);

			// 按钮的 DOM 锚点：插入到输入栏 trailing 行的发送按钮正前方，
			// 使按钮位于「用量」与「发送」之间（slot 座位本身在模型选择器左侧）。
			var anchorRef = useRef(null);
			if (anchorRef.current === null && typeof document !== "undefined") {
				var anchorEl = document.createElement("span");
				anchorEl.style.cssText = "display:contents";
				anchorEl.setAttribute("data-dsh-vault-anchor", "");
				anchorRef.current = anchorEl;
			}

			useEffect(function () {
				var anchor = anchorRef.current;
				if (!anchor) return;
				// 找到 trailing 行中直接子级的最后一个主按钮（发送/停止共用 _primary）
				var findSendSlot = function () {
					var row = document.querySelector('[class$="_trailing"]');
					if (!row) return null;
					var primaries = row.querySelectorAll('[class$="_primary"]');
					var send = primaries.length > 0 ? primaries[primaries.length - 1] : null;
					if (!send) return null;
					// 按钮可能被 Tooltip 等包装：向上找到 row 的直接子级
					var el = send;
					while (el && el.parentElement && el.parentElement !== row) el = el.parentElement;
					return el && el.parentElement === row ? el : null;
				};
				var place = function () {
					var slot = findSendSlot();
					if (!slot) return false;
					if (anchor.parentElement !== slot.parentElement) slot.parentElement.insertBefore(anchor, slot);
					return true;
				};
				place();
				// 常驻观察者：composer 重建（会话切换/hero 切换）导致锚点被移除时重新插入。
				// 稳定时回调只做一次 isConnected 判断，开销可忽略。
				var observer = new MutationObserver(function () {
					if (!anchor.isConnected || anchor.parentElement === null) place();
				});
				observer.observe(document.body, { childList: true, subtree: true });
				return function () {
					if (observer) { try { observer.disconnect(); } catch (e) { /* ignore */ } }
					try { if (anchor.parentElement) anchor.parentElement.removeChild(anchor); } catch (e) { /* ignore */ }
				};
			}, []);

			var closePanel = useCallback(function () {
				setClosing(true);
				setTimeout(function () {
					setClosing(false);
					setOpen(false);
				}, 140);
			}, []);

			var openPanel = useCallback(function () {
				if (open) return;
				setClosing(false);
				setOpen(true);
			}, [open]);

			useEffect(function () {
				var un1 = runtime.on("suggestions", function (items) { setSuggestions(items); });
				var un2 = runtime.on("status", function (s) { setStatus(s); });
				var un3 = runtime.on("suggestions-new", function () { setPulse(Date.now()); });
				return function () { un1(); un2(); un3(); };
			}, []);

			useEffect(function () {
				if (!open) return;
				var recompute = function () {
					var el = btnRef.current;
					if (!el) return;
					var r = el.getBoundingClientRect();
					setPos({
						right: Math.max(8, Math.round(window.innerWidth - r.right + 6)),
						bottom: Math.max(8, Math.round(window.innerHeight - r.top + 14)),
					});
				};
				recompute();
				window.addEventListener("resize", recompute);
				window.addEventListener("scroll", recompute, true);
				var onDown = function (e) {
					if (closing) return;
					if (e.target && e.target.closest && e.target.closest(".dsh-vault-modal-layer")) return;
					if (panelRef.current && panelRef.current.contains(e.target)) return;
					if (btnRef.current && btnRef.current.contains(e.target)) return;
					closePanel();
				};
				var onKey = function (e) {
					if (e.key !== "Escape") return;
					if (document.querySelector(".dsh-vault-modal-layer")) return;
					closePanel();
				};
				document.addEventListener("mousedown", onDown);
				document.addEventListener("keydown", onKey);
				return function () {
					window.removeEventListener("resize", recompute);
					window.removeEventListener("scroll", recompute, true);
					document.removeEventListener("mousedown", onDown);
					document.removeEventListener("keydown", onKey);
				};
			}, [open, closing, closePanel]);

			var pendingCount = status && status.pendingCount ? status.pendingCount : 0;

			var buttonNode = createElement("span", { style: { position: "relative", flex: "none", display: "inline-flex" } },
				createElement("button", {
					type: "button",
					ref: btnRef,
					className: "dsh-vault-btn",
					"aria-label": t("nav"),
					title: t("nav"),
					onMouseDown: function (e) { e.preventDefault(); },
					onClick: function (e) {
						e.preventDefault();
						if (open) closePanel(); else openPanel();
					},
					style: {
						background: "var(--dsw-alias-bg-layer-3)",
						color: "var(--dsw-alias-label-secondary)",
						cursor: "pointer",
						border: "1px solid var(--dsw-alias-border-l2)",
						borderRadius: 999,
						flex: "none",
						placeItems: "center",
						width: 34,
						height: 34,
						transition: "background-color .1s",
						display: "grid",
						transform: "translateY(-2px)",
						padding: 0,
					},
				}, createElement(KeyIcon, { size: 16 })),
				pendingCount > 0 && !open
					? createElement("span", {
						style: {
							position: "absolute",
							top: -2,
							right: -2,
							width: 9,
							height: 9,
							borderRadius: 999,
							background: "var(--dsw-alias-state-error-primary, #ef4444)",
							border: "2px solid var(--dsw-alias-bg-layer-3)",
							pointerEvents: "none",
							animation: Date.now() - pulse < 1600 ? "dsh-vault-ping 1.1s ease-out" : undefined,
						},
					})
					: null
			);

			return createElement(React.Fragment, null,
				anchorRef.current
					? createPortal(buttonNode, anchorRef.current)
					: null,
				open
					? createPortal(
						createElement("div", {
							ref: panelRef,
							className: "dsh-vault-panel" + (closing ? " dsh-vault-panel-closing" : ""),
							style: Object.assign({}, panelStyle, { right: pos.right, bottom: pos.bottom }),
						},
							createElement(VaultPanel, {
								inputActions: inputActions,
								suggestions: suggestions,
								onClose: closePanel,
							})
						),
						document.body
					)
					: null
			);
		}

		// ---- panel body (phase machine: boot / error / setup / migrate / main)

		function VaultPanel(props) {
			var [phase, setPhase] = useState("boot");
			var [error, setError] = useState("");
			var [notice, setNotice] = useState("");
			var [query, setQuery] = useState("");
			var [activeCat, setActiveCat] = useState("全部");
			var [modal, setModal] = useState(null);
			var [unlocked, setUnlocked] = useState(false);
			var [records, setRecords] = useState([]);
			var [webdav, setWebdav] = useState(null);
			var [suggestions, setSuggestions] = useState(props.suggestions || []);
			var [noticeSeq, setNoticeSeq] = useState(0);

			var showNotice = useCallback(function (text) {
				setNotice(text);
				setNoticeSeq(function (n) { return n + 1; });
			}, []);

			// 从运行时同步面板状态（记录视图 / 解锁态 / WebDAV 配置）
			var sync = useCallback(function () {
				setUnlocked(!!runtime.key);
				setRecords(recordsView(runtime.store));
				setWebdav(runtime.webdav);
			}, []);

			useEffect(function () {
				var un1 = runtime.on("suggestions", function (items) { setSuggestions(items); });
				var un2 = runtime.on("locked", function (msg) {
					sync();
					if (msg) showNotice(msg);
				});
				return function () { un1(); un2(); };
			}, [sync, showNotice]);

			useEffect(function () {
				var cancelled = false;
				api("loadStore").then(function (store) {
					if (cancelled) return;
					runtime.store = store;
					if (!store || store.setup !== true) { setPhase("setup"); return; }
					if (store.version !== 2) { setPhase("migrate"); return; }
					sync();
					setPhase("main");
				}).catch(function () {
					if (!cancelled) setPhase("error");
				});
				return function () { cancelled = true; };
			}, [sync]);

			// 提示自动消失
			useEffect(function () {
				if (notice === "") return;
				var timer = setTimeout(function () { setNotice(""); }, 4200);
				return function () { clearTimeout(timer); };
			}, [noticeSeq]); // eslint-disable-line react-hooks/exhaustive-deps

			// 模态框打开时 Esc 优先关闭模态框（外层 Esc 逻辑见 .dsh-vault-modal-layer 守卫）
			useEffect(function () {
				if (!modal) return;
				var onKey = function (e) {
					if (e.key === "Escape") setModal(null);
				};
				document.addEventListener("keydown", onKey);
				return function () { document.removeEventListener("keydown", onKey); };
			}, [modal]);

			// ---- setup / migrate / unlock / reset

			var doSetup = useCallback(function (password, securityWord) {
				return setupVault(password, securityWord).then(function () {
					sync();
					setModal({ kind: "setupDone", securityWord: securityWord });
					setPhase("main");
				});
			}, [sync]);

			var doMigrate = useCallback(function (password) {
				return migrateV1(password).then(function () {
					sync();
					setPhase("main");
				});
			}, [sync]);

			// 忘记密码时：用安全词解出 K → 设新密码（标准参数包裹）→ 用新密码完成迁移。
			// 安全词本身错误 → reject {code:"verify-fail"}；后续迁移失败 → {code:"migrate-fail"}。
			var doMigrateViaSecurityWord = useCallback(function (securityWord, newPassword) {
				var store = runtime.store;
				if (!store || !store.wrapSec) return Promise.reject(new Error("no-security-word"));
				var resetOk = false;
				return resetWithSecurityWord(securityWord, newPassword, undefined).then(function () {
					resetOk = true;
					return migrateV1(newPassword);
				}).then(function () {
					sync();
					setPhase("main");
				}).catch(function (e) {
					if (!resetOk) {
						var v = new Error("verify-fail");
						v.code = "verify-fail";
						throw v;
					}
					var m = new Error(String((e && e.message) || "migrate-fail"));
					m.code = "migrate-fail";
					throw m;
				});
			}, [sync]);

			// 旧库无数据（vault 为空）时的兜底：不验证旧密码/安全词，直接重建全新的空保险箱。
			var doRebuildEmpty = useCallback(function (password, securityWord) {
				return setupVault(password, securityWord).then(function () {
					sync();
					setPhase("main");
					setModal({ kind: "setupDone", securityWord: securityWord });
				});
			}, [sync]);

			var doVerify = useCallback(function (password) {
				return unlockVault(password).then(function () {
					sync();
					return true;
				}).catch(function () {
					return false;
				});
			}, [sync]);

			var doReset = useCallback(function (securityWord, newPassword, newSecurityWord) {
				return resetWithSecurityWord(securityWord, newPassword, newSecurityWord).then(function () {
					sync();
					showNotice(t("pwChanged"));
					setModal(null);
				}).catch(function () {
					throw new Error("verify-fail");
				});
			}, [sync, showNotice]);

			var lockPanel = useCallback(function () {
				lockVault();
				sync();
			}, [sync]);

			// ---- record ops

			var addRecord = useCallback(function (data) {
				var record = {
					id: uuid(),
					name: String(data.name || "").trim(),
					category: String(data.category || "其他").trim() || "其他",
					tags: data.tags || [],
					createdAt: new Date().toISOString(),
					updatedAt: new Date().toISOString(),
					private: data.private === true,
				};
				var finish = function () {
					runtime.store.records.push(record);
					return saveStoreToHost().then(function () {
						sync();
						setModal(null);
						showNotice(t("formAdd") + " ✓");
					}).catch(function (e) {
						showNotice(String((e && e.message) || "save failed"));
					});
				};
				if (record.private) {
					if (!runtime.key) return Promise.reject(new Error("locked"));
					return recordEncrypt(runtime.key, String(data.content || "")).then(function (blob) {
						record.content = null;
						record.enc = blob;
						return finish();
					});
				}
				record.content = String(data.content || "");
				return finish();
			}, [sync, showNotice, t]);

			var updateRecord = useCallback(function (rec, data) {
				var found = null;
				for (var i = 0; i < runtime.store.records.length; i += 1) {
					if (runtime.store.records[i].id === rec.id) { found = runtime.store.records[i]; break; }
				}
				if (!found) return Promise.resolve();
				found.name = String(data.name || "").trim();
				found.category = String(data.category || "其他").trim() || "其他";
				found.tags = data.tags || [];
				found.updatedAt = new Date().toISOString();
				found.private = data.private === true;
				var finish = function () {
					return saveStoreToHost().then(function () {
						sync();
						setModal(null);
						showNotice(t("formEdit") + " ✓");
					}).catch(function (e) {
						showNotice(String((e && e.message) || "save failed"));
					});
				};
				if (found.private) {
					if (!runtime.key) return Promise.reject(new Error("locked"));
					return recordEncrypt(runtime.key, String(data.content || "")).then(function (blob) {
						found.content = null;
						found.enc = blob;
						return finish();
					});
				}
				found.content = String(data.content || "");
				delete found.enc;
				return finish();
			}, [sync, showNotice, t]);

			var deleteRecord = useCallback(function (rec) {
				runtime.store.records = runtime.store.records.filter(function (r) { return r.id !== rec.id; });
				return saveStoreToHost().then(function () {
					sync();
					setModal(null);
				}).catch(function (e) {
					showNotice(String((e && e.message) || "save failed"));
				});
			}, [sync, showNotice]);

			// ---- fill / send

			var fillRecord = useCallback(function (rec, sendNow) {
				var actions = props.inputActions;
				try { console.log("[vault:fill]", rec.id, "private=" + rec.private, "key=" + !!runtime.key, "sendNow=" + sendNow); } catch (e) { /* ignore */ }
				if (!actions || typeof actions.setDraft !== "function") {
					try { console.warn("[vault:fill] no inputActions/setDraft", actions); } catch (err) { /* ignore */ }
					showNotice(t("noInput"));
					return;
				}
				if (rec.private === true && !runtime.key) {
					setModal({ kind: "private", rec: rec, sendNow: sendNow });
					return;
				}
				var content = rec.private === true
					? (runtime.privateById ? (runtime.privateById[rec.id] || "") : "")
					: (rec.content || "");
				try { console.log("[vault:fill] content length=" + content.length, JSON.stringify(content.slice(0, 40))); } catch (err) { /* ignore */ }
				if (content === "") {
					showNotice(rec.private === true ? "⚠ 私密内容为空或解密失败" : t("noInput"));
					return;
				}
				// 追加到当前输入位置（光标处/替换选区），不覆盖已有文字
				insertIntoComposer(actions, content);
				if (sendNow && typeof actions.submit === "function") {
					actions.submit();
				}
				props.onClose();
			}, [props.inputActions, props.onClose, showNotice, t]);

			// ---- settings helpers

			var setAutoDetect = useCallback(function (value) {
				api("saveConfig", { autoDetect: value }).catch(function () {});
			}, []);

			var setAutoLock = useCallback(function (minutes) {
				if (!runtime.store) return;
				runtime.store.autoLockMinutes = minutes;
				saveStoreToHost().catch(function () {});
				sync();
			}, [sync]);

			var saveWebdav = useCallback(function (config) {
				if (!runtime.key) return Promise.reject(new Error("locked"));
				runtime.webdav = { url: config.url, username: config.username, password: config.password };
				return recordEncrypt(runtime.key, JSON.stringify(runtime.webdav)).then(function (blob) {
					runtime.store.webdav = blob;
					return saveStoreToHost().then(function () {
						sync();
					});
				});
			}, [sync]);

			var doBackup = useCallback(function (filename) {
				if (!runtime.webdav || String(runtime.webdav.url).trim() === "") return Promise.reject(new Error("no-webdav"));
				return api("webdav", {
					url: String(runtime.webdav.url).trim().replace(/\/+$/, "") + "/" + filename,
					method: "PUT",
					body: JSON.stringify(runtime.store),
					username: String(runtime.webdav.username || "").trim(),
					password: runtime.webdav.password || "",
				}).then(function (res) {
					if (!res.ok) throw new Error((res.statusText || "HTTP " + res.status) + (res.body ? " " + String(res.body).slice(0, 200) : ""));
					return true;
				});
			}, []);

			var doRestore = useCallback(function (filename) {
				if (!runtime.webdav || String(runtime.webdav.url).trim() === "") return Promise.reject(new Error("no-webdav"));
				return api("webdav", {
					url: String(runtime.webdav.url).trim().replace(/\/+$/, "") + "/" + filename,
					method: "GET",
					username: String(runtime.webdav.username || "").trim(),
					password: runtime.webdav.password || "",
				}).then(function (res) {
					if (!res.ok) throw new Error("HTTP " + (res.status || res.statusText || "?"));
					var store = JSON.parse(res.body);
					if (!store || store.wrapPw === undefined) throw new Error("invalid backup");
					return api("saveStore", { store: store }).then(function () { return store; });
				}).then(function (store) {
					runtime.store = store;
					lockVault();
					if (store.version !== 2) {
						// 旧版本备份（v1）：回到迁移页，用密码/安全词升级
						setPhase("migrate");
					} else {
						sync();
					}
					return true;
				});
			}, [sync]);

			var doChangePw = useCallback(function (currentPassword, newPassword) {
				return changePassword(currentPassword, newPassword);
			}, []);

			// ---- suggestion ops

			var recordFromSuggestion = useCallback(function (item) {
				var name = item.category + " · " + String(item.value).slice(0, 24);
				setModal({
					kind: "add",
					preset: {
						name: name,
						content: item.value,
						category: item.category,
						private: item.private === true,
					},
					onSaved: function () {
						api("suggestAck", { ids: [item.id], ignore: false }).then(function () {
							api("suggestions").then(function (v) { setSuggestions((v && v.items) || []); }).catch(function () {});
						}).catch(function () {});
					},
				});
			}, []);

			var ignoreSuggestion = useCallback(function (item) {
				api("suggestAck", { ids: [item.id], ignore: true }).then(function () {
					setSuggestions(function (prev) { return prev.filter(function (s) { return s.id !== item.id; }); });
				}).catch(function () {});
			}, []);

			var ignoreAllSuggestions = useCallback(function () {
				api("clearSuggestions").then(function () { setSuggestions([]); }).catch(function () {});
			}, []);

			// ---- derived list

			var q = String(query || "").trim().toLowerCase();
			var searching = q !== "";
			var visible = records
				.filter(function (r) {
					if (!searching && activeCat !== "全部" && r.category !== activeCat) return false;
					if (searching) {
						var hay = ((r.name || "") + " " + (r.tags || []).join(" ") + " " + (r.category || "")).toLowerCase();
						if (hay.indexOf(q) === -1) return false;
					}
					return true;
				})
				.slice()
				.sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); });

			var cats = categoriesOf(records);
			var hasPrivate = records.some(function (r) { return r.private === true; });

			var header = createElement("div", { style: { display: "flex", alignItems: "center", gap: 8, padding: "12px 12px 0", flex: "none" } },
				createElement("div", { style: { position: "relative", flex: 1, minWidth: 0 } },
					createElement("span", { style: { position: "absolute", left: 9, top: 0, bottom: 0, display: "flex", alignItems: "center", color: "var(--dsw-alias-label-tertiary)", pointerEvents: "none" } },
						createElement(IconSearchOutline16, { size: 14 })),
					createElement("input", {
						type: "text",
						value: query,
						placeholder: t("searchPlaceholder"),
						onChange: function (e) { setQuery(e.target.value); },
						style: Object.assign({}, inputStyle, { paddingLeft: 30 }),
					})
				),
				createElement(Button, { size: "sm", variant: "primary", onClick: function () { setModal({ kind: "add" }); } },
					createElement(IconPlusOutline16, { size: 14 }), " " + t("add")),
				unlocked
					? createElement("button", {
						type: "button",
						onClick: lockPanel,
						style: iconBtnStyle,
						title: t("lockNow"),
						"aria-label": t("lockNow"),
					}, createElement(LockIcon, { size: 14 }))
					: null
			);

			var privateHint = !unlocked && hasPrivate
				? createElement("div", { style: { margin: "10px 12px 0", border: "1px solid var(--dsw-alias-border-l1, var(--dsw-alias-border-l2))", borderRadius: 10, background: "var(--dsw-alias-bg-layer-2)", padding: "7px 11px", fontSize: 11.5, color: "var(--dsw-alias-label-tertiary)", lineHeight: 1.5, flex: "none" } },
					t("privateLockedHint"))
				: null;

			var suggestionBanner = suggestions.length > 0
				? createElement("div", { style: { margin: "10px 12px 0", border: "1px solid var(--dsw-alias-border-l2)", borderRadius: 12, background: "var(--dsw-alias-bg-layer-2)", padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8, flex: "none" } },
					createElement("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 } },
						createElement("span", { style: { fontSize: 12.5, fontWeight: 700, color: "var(--dsw-alias-label-primary)" } }, t("suggestTitle", { n: suggestions.length })),
						createElement("button", { type: "button", onClick: ignoreAllSuggestions, style: Object.assign({}, iconBtnStyle, { color: "var(--dsw-alias-label-tertiary)", fontSize: 11.5, width: "auto", padding: "0 6px" }) }, t("ignoreAll"))
					),
					createElement("div", { className: "dsh-vault-scroll", style: { display: "flex", flexDirection: "column", gap: 6, maxHeight: 92, overflowY: "auto" } },
						suggestions.slice(0, 3).map(function (item) {
							return createElement("div", { key: item.id, style: { display: "flex", alignItems: "center", gap: 8, minWidth: 0 } },
								createElement("span", { style: Object.assign({}, chipStyle, { flex: "none" }) }, item.category),
								createElement("span", { style: { flex: 1, minWidth: 0, fontSize: 11.5, color: "var(--dsw-alias-label-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "ui-monospace,Menlo,Consolas,monospace" } }, item.value),
								createElement(Button, { size: "sm", variant: "primary", style: { flex: "none" }, onClick: function () { recordFromSuggestion(item); } }, t("record")),
								createElement(Button, { size: "sm", variant: "ghost", style: { flex: "none" }, onClick: function () { ignoreSuggestion(item); } }, t("ignore"))
							);
						})
					),
					suggestions.length > 3
						? createElement("button", {
							type: "button",
							onClick: function () { setModal({ kind: "suggestions" }); },
							style: { border: "none", background: "transparent", color: "var(--dsw-alias-brand-primary)", fontSize: 11, cursor: "pointer", padding: 0, textAlign: "left", textDecoration: "underline" },
						}, t("more", { n: suggestions.length - 3 }) + " →")
						: null
				)
				: null;

			var body = createElement("div", { style: { display: "flex", flex: 1, minHeight: 0, marginTop: 10 } },
				// 左侧分类栏
				createElement("div", { className: "dsh-vault-scroll", style: { width: 110, flex: "none", overflowY: "auto", padding: "0 6px 8px", boxSizing: "border-box", borderRight: "1px solid var(--dsw-alias-border-l1, var(--dsw-alias-border-l2))", display: "flex", flexDirection: "column", gap: 2 } },
					createElement(CatItem, {
						label: t("all"),
						count: records.length,
						selected: !searching && activeCat === "全部",
						onClick: function () { setActiveCat("全部"); },
					}),
					cats.map(function (c) {
						return createElement(CatItem, {
							key: c.name,
							label: c.name,
							count: c.count,
							selected: !searching && activeCat === c.name,
							onClick: function () { setActiveCat(c.name); },
						});
					})
				),
				// 右侧记录列表
				createElement("div", { className: "dsh-vault-scroll", style: { flex: 1, minWidth: 0, overflowY: "auto", padding: "2px 8px 10px", display: "flex", flexDirection: "column", gap: 6 } },
					visible.length === 0
						? createElement("div", { style: { padding: "34px 12px", textAlign: "center", fontSize: 12.5, color: "var(--dsw-alias-label-tertiary)" } },
							searching ? t("noSearch") : t("noRecords"))
						: visible.map(function (rec) {
							return createElement(RecordRow, {
								key: rec.id,
								rec: rec,
								onUse: function (sendNow) { fillRecord(rec, sendNow); },
								onEdit: function () {
									if (rec.private === true && !runtime.key) {
										// 编辑私密记录前先验证密码，验证后同步再打开表单
										setModal({
											kind: "privateFirst",
											rec: rec,
											after: function () {
												setModal({ kind: "edit", rec: rec });
											},
										});
										return;
									}
									setModal({ kind: "edit", rec: rec });
								},
								onDelete: function () { setModal({ kind: "confirm", rec: rec }); },
							});
						})
				)
			);

			var noticeEl = notice !== ""
				? createElement("div", { style: { flex: "none", padding: "8px 12px 4px", fontSize: 12, color: "var(--dsw-alias-label-secondary)" } }, notice)
				: null;

			var content = null;
			if (phase === "boot") {
				content = createElement("div", { style: { padding: "34px 16px", textAlign: "center", fontSize: 13, color: "var(--dsw-alias-label-tertiary)" } }, t("loading"));
			} else if (phase === "error") {
				content = createElement("div", { style: { padding: "30px 16px", textAlign: "center", display: "flex", flexDirection: "column", gap: 12, alignItems: "center" } },
					createElement("div", { style: { fontSize: 13, color: "var(--dsw-alias-state-error-primary)" } }, t("loadFail")),
					createElement(Button, { size: "sm", variant: "outline", onClick: function () { setPhase("boot"); } }, t("retry"))
				);
			} else if (phase === "setup") {
				content = createElement(SetupView, { onDone: doSetup, t: t });
			} else if (phase === "migrate") {
				content = createElement(MigrateView, { onDone: doMigrate, onReset: doMigrateViaSecurityWord, onRebuild: doRebuildEmpty, t: t });
			} else {
				content = createElement("div", { style: { display: "flex", flexDirection: "column", flex: 1, minHeight: 0 } },
					header,
					privateHint,
					suggestionBanner,
					body,
					noticeEl
				);
			}

			return createElement("div", { style: { display: "flex", flexDirection: "column", flex: 1, minHeight: 0 } },
				content,
				renderModals(modal, {
					t: t,
					setModal: setModal,
					unlocked: unlocked,
					records: records,
					webdav: webdav,
					suggestions: suggestions,
					addRecord: addRecord,
					updateRecord: updateRecord,
					deleteRecord: deleteRecord,
					fillRecord: fillRecord,
					showNotice: showNotice,
					doVerify: doVerify,
					doReset: doReset,
					recordFromSuggestion: recordFromSuggestion,
					ignoreSuggestion: ignoreSuggestion,
					ignoreAllSuggestions: ignoreAllSuggestions,
					onContentOf: function (id) { return runtime.privateById ? (runtime.privateById[id] || "") : ""; },
					autoLockMinutes: runtime.store ? runtime.store.autoLockMinutes : 10,
				})
			);
		}

		// ---- category item

		function CatItem(props) {
			return createElement("button", {
				type: "button",
				onClick: props.onClick,
				style: {
					display: "flex",
					alignItems: "center",
					justifyContent: "space-between",
					gap: 6,
					padding: "6px 8px",
					borderRadius: 8,
					border: "none",
					background: props.selected ? "var(--dsw-alias-interactive-bg-hover)" : "transparent",
					color: props.selected ? "var(--dsw-alias-label-primary)" : "var(--dsw-alias-label-secondary)",
					fontSize: 12.5,
					fontWeight: props.selected ? 700 : 500,
					cursor: "pointer",
					textAlign: "left",
					width: "100%",
					boxSizing: "border-box",
				},
			},
				createElement("span", { style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 } }, props.label),
				createElement("span", { style: { fontSize: 10.5, color: "var(--dsw-alias-label-tertiary)", flex: "none" } }, props.count)
			);
		}

		// ---- record row

		function RecordRow(props) {
			var rec = props.rec;
			var preview = rec.private === true && rec.locked
				? "••••••••••••"
				: String(rec.content || "").replace(/\s+/g, " ").slice(0, 60);

			return createElement("div", {
				style: {
					display: "flex",
					alignItems: "center",
					gap: 8,
					padding: "8px 10px",
					borderRadius: 11,
					border: "1px solid var(--dsw-alias-border-l1, var(--dsw-alias-border-l2))",
					background: "var(--dsw-alias-bg-layer-2)",
					cursor: "pointer",
					transition: "background-color .1s",
				},
				onMouseEnter: function (e) { e.currentTarget.style.background = "var(--dsw-alias-interactive-bg-hover)"; },
				onMouseLeave: function (e) { e.currentTarget.style.background = "var(--dsw-alias-bg-layer-2)"; },
				onClick: function (e) { props.onUse(e.ctrlKey || e.metaKey); },
				title: (rec.private === true && rec.locked ? "🔒 " : "") + rec.name,
			},
				createElement("div", { style: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 } },
					createElement("div", { style: { display: "flex", alignItems: "center", gap: 6, minWidth: 0 } },
						createElement("span", { style: { fontSize: 13, fontWeight: 700, color: "var(--dsw-alias-label-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: "none", maxWidth: "60%" } }, rec.name),
						createElement("span", { style: Object.assign({}, chipStyle, { flex: "none" }) }, rec.category || "其他"),
						rec.private === true
							? createElement("span", { style: Object.assign({}, chipStyle, { flex: "none", color: "var(--dsw-alias-state-warning-primary, #d97706)", background: "var(--dsw-alias-bg-warning-soft, var(--dsw-alias-interactive-bg-hover))" }) },
								createElement(LockIcon, { size: 10 }), " " + t("privateBadge"))
							: null
					),
					createElement("div", { style: { fontSize: 11.5, color: "var(--dsw-alias-label-tertiary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "ui-monospace,Menlo,Consolas,monospace" } }, preview),
					createElement("div", { style: { display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" } },
						(rec.tags || []).slice(0, 4).map(function (tag) {
							return createElement("span", { key: tag, style: { fontSize: 10, color: "var(--dsw-alias-label-tertiary)", background: "var(--dsw-alias-interactive-bg-hover)", borderRadius: 999, padding: "0 6px", lineHeight: "16px" } }, "#" + tag);
						}),
						createElement("span", { style: { fontSize: 10.5, color: "var(--dsw-alias-label-tertiary)", opacity: 0.8 } }, t("createdAt") + " " + fmtTime(rec.createdAt))
					)
				),
				createElement("button", {
					type: "button",
					style: Object.assign({}, iconBtnStyle, { width: 24, height: 24 }),
					title: t("formEdit"),
					"aria-label": t("formEdit"),
					onClick: function (e) { e.stopPropagation(); props.onEdit(); },
				}, createElement(IconEditOutline16, { size: 13 })),
				createElement("button", {
					type: "button",
					style: Object.assign({}, iconBtnStyle, { width: 24, height: 24 }),
					title: t("delete"),
					"aria-label": t("delete"),
					onClick: function (e) { e.stopPropagation(); props.onDelete(); },
				}, createElement(IconTrashOutline16, { size: 13 }))
			);
		}

		// ---- setup view

		function SetupView(props) {
			var [pw, setPw] = useState("");
			var [pw2, setPw2] = useState("");
			var [sec, setSec] = useState("");
			var [sec2, setSec2] = useState("");
			var [busy, setBusy] = useState(false);
			var [error, setError] = useState("");

			var submit = function () {
				if (pw.length < 4) { setError(props.t("passwordShort")); return; }
				if (pw !== pw2) { setError(props.t("passwordMismatch")); return; }
				if (sec.length < 2) { setError(props.t("securityShort")); return; }
				if (sec !== sec2) { setError(props.t("securityMismatch")); return; }
				setBusy(true);
				props.onDone(pw, sec).catch(function (e) {
					setError(String((e && e.message) || "error"));
					setBusy(false);
				});
			};

			return createElement("div", { className: "dsh-vault-scroll", style: { padding: "16px 16px 18px", display: "flex", flexDirection: "column", gap: 12, overflowY: "auto" } },
				createElement("div", { style: { fontSize: 15, fontWeight: 700, color: "var(--dsw-alias-label-primary)" } }, props.t("setupTitle")),
				createElement("div", { style: { fontSize: 12, color: "var(--dsw-alias-label-tertiary)", lineHeight: 1.6 } }, props.t("setupDesc")),
				createElement(Field, { label: props.t("password") }, createElement(PasswordInput, { value: pw, onChange: setPw, placeholder: "••••••••" })),
				createElement(Field, { label: props.t("confirmPassword") }, createElement(PasswordInput, { value: pw2, onChange: setPw2, onEnter: submit })),
				createElement(Field, { label: props.t("securityWord"), hint: props.t("securityWordDesc") }, createElement(PasswordInput, { value: sec, onChange: setSec })),
				createElement(Field, { label: props.t("confirmSecurityWord") }, createElement(PasswordInput, { value: sec2, onChange: setSec2, onEnter: submit })),
				error !== "" ? createElement("div", { style: { fontSize: 12, color: "var(--dsw-alias-state-error-primary)" } }, error) : null,
				createElement("div", { style: { display: "flex", justifyContent: "flex-end", gap: 8 } },
					createElement(Button, { size: "md", variant: "primary", disabled: busy, onClick: submit }, busy ? "…" : props.t("create"))
				)
			);
		}

		// ---- migrate view (v1 → v2)

		function MigrateView(props) {
			var [pw, setPw] = useState("");
			var [busy, setBusy] = useState(false);
			var [error, setError] = useState("");
			// 忘记密码时的安全词重置并迁移
			var [resetMode, setResetMode] = useState(false);
			// 空库重建（vault 为空时无需旧密码/安全词）
			var [rebuildMode, setRebuildMode] = useState(false);
			var [sec, setSec] = useState("");
			var [npw, setNpw] = useState("");
			var [npw2, setNpw2] = useState("");

			var submit = function () {
				if (pw === "") return;
				setBusy(true);
				setError("");
				props.onDone(pw).then(function () {
					setBusy(false);
				}).catch(function () {
					setBusy(false);
					setError(props.t("migrateFail"));
				});
			};

			var submitReset = function () {
				if (sec === "") return;
				if (npw.length < 4) { setError(props.t("passwordShort")); return; }
				if (npw !== npw2) { setError(props.t("passwordMismatch")); return; }
				setBusy(true);
				setError("");
				props.onReset(sec, npw).then(function () {
					setBusy(false);
				}).catch(function (e) {
					setBusy(false);
					setError((e && e.code === "migrate-fail") ? props.t("migrateFail") : props.t("verifyFail"));
				});
			};

			var head = createElement("div", { style: { display: "flex", alignItems: "center", gap: 10 } },
				createElement("span", { style: { display: "inline-flex", alignItems: "center", justifyContent: "center", width: 34, height: 34, borderRadius: 999, background: "var(--dsw-alias-interactive-bg-hover)", color: "var(--dsw-alias-label-secondary)" } },
					createElement(LockIcon, { size: 16 })),
				createElement("div", { style: { display: "flex", flexDirection: "column", gap: 2 } },
					createElement("div", { style: { fontSize: 14, fontWeight: 700, color: "var(--dsw-alias-label-primary)" } }, props.t("migrateTitle")),
					createElement("div", { style: { fontSize: 11.5, color: "var(--dsw-alias-label-tertiary)", lineHeight: 1.6 } }, props.t("migrateDesc"))
				)
			);

			if (resetMode) {
				return createElement("div", { style: { padding: "18px 16px 20px", display: "flex", flexDirection: "column", gap: 12 } },
					head,
					createElement("div", { style: { fontSize: 12, color: "var(--dsw-alias-label-tertiary)", lineHeight: 1.6 } }, props.t("resetDesc")),
					createElement(Field, { label: props.t("securityWord") }, createElement(PasswordInput, { value: sec, onChange: setSec })),
					createElement(Field, { label: props.t("newPassword") }, createElement(PasswordInput, { value: npw, onChange: setNpw })),
					createElement(Field, { label: props.t("confirmPassword") }, createElement(PasswordInput, { value: npw2, onChange: setNpw2, onEnter: submitReset })),
					error !== "" ? createElement("div", { style: { fontSize: 12, color: "var(--dsw-alias-state-error-primary)" } }, error) : null,
					createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 } },
						createElement("button", {
							type: "button",
							onClick: function () { setResetMode(false); setError(""); },
							style: { border: "none", background: "transparent", color: "var(--dsw-alias-label-tertiary)", fontSize: 11.5, cursor: "pointer", padding: 0 },
						}, "← " + props.t("migrate")),
						createElement(Button, { size: "md", variant: "primary", disabled: busy || sec === "", onClick: submitReset }, busy ? "…" : props.t("verify"))
					)
				);
			}

			if (rebuildMode) {
				return createElement("div", { style: { padding: "18px 16px 20px", display: "flex", flexDirection: "column", gap: 12 } },
					head,
					createElement("div", { style: { fontSize: 12, color: "var(--dsw-alias-state-warning-primary, #d97706)", lineHeight: 1.6 } }, props.t("rebuildWarn")),
					createElement(Field, { label: props.t("password") }, createElement(PasswordInput, { value: npw, onChange: setNpw })),
					createElement(Field, { label: props.t("confirmPassword") }, createElement(PasswordInput, { value: npw2, onChange: setNpw2 })),
					createElement(Field, { label: props.t("securityWord"), hint: props.t("securityWordDesc") }, createElement(PasswordInput, { value: sec, onChange: setSec })),
					error !== "" ? createElement("div", { style: { fontSize: 12, color: "var(--dsw-alias-state-error-primary)" } }, error) : null,
					createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 } },
						createElement("button", {
							type: "button",
							onClick: function () { setRebuildMode(false); setError(""); },
							style: { border: "none", background: "transparent", color: "var(--dsw-alias-label-tertiary)", fontSize: 11.5, cursor: "pointer", padding: 0 },
						}, "← " + props.t("migrate")),
						createElement(Button, {
							size: "md",
							variant: "primary",
							disabled: busy || npw.length < 4 || npw !== npw2 || sec.length < 2,
							onClick: function () {
								setBusy(true);
								setError("");
								props.onRebuild(npw, sec).then(function () {
									setBusy(false);
								}).catch(function (e) {
									setBusy(false);
									setError(String((e && e.message) || "error"));
								});
							},
						}, busy ? "…" : props.t("rebuild"))
					)
				);
			}

			return createElement("div", { style: { padding: "18px 16px 20px", display: "flex", flexDirection: "column", gap: 12 } },
				head,
				createElement(Field, { label: props.t("password") }, createElement(PasswordInput, { value: pw, onChange: setPw, onEnter: submit })),
				error !== "" ? createElement("div", { style: { fontSize: 12, color: "var(--dsw-alias-state-error-primary)" } }, error) : null,
				createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 } },
					createElement("div", { style: { display: "flex", gap: 4 } },
						createElement("button", {
							type: "button",
							onClick: function () { setResetMode(true); setError(""); },
							style: { border: "none", background: "transparent", color: "var(--dsw-alias-brand-primary)", fontSize: 11.5, cursor: "pointer", padding: 0 },
						}, props.t("forgot")),
						createElement("span", { style: { fontSize: 11.5, color: "var(--dsw-alias-label-tertiary)" } }, "·"),
						createElement("button", {
							type: "button",
							onClick: function () { setRebuildMode(true); setError(""); },
							style: { border: "none", background: "transparent", color: "var(--dsw-alias-label-tertiary)", fontSize: 11.5, cursor: "pointer", padding: 0, textDecoration: "underline" },
						}, props.t("rebuildEmpty"))
					),
					createElement(Button, { size: "md", variant: "primary", disabled: busy || pw === "", onClick: submit }, busy ? "…" : props.t("migrate"))
				)
			);
		}

		// ---- record form modal

		function RecordFormModal(props) {
			var editing = props.rec !== undefined;
			var [name, setName] = useState(props.preset ? props.preset.name : (props.rec ? props.rec.name : ""));
			var [content, setContent] = useState(props.preset ? props.preset.content : (props.rec ? (props.initialContent !== undefined ? props.initialContent : props.rec.content) : ""));
			var [category, setCategory] = useState(props.preset ? props.preset.category : (props.rec ? (props.rec.category || "其他") : "其他"));
			var [tags, setTags] = useState(props.rec ? (props.rec.tags || []).join(", ") : "");
			var [isPrivate, setPrivate] = useState(props.preset ? !!props.preset.private : (props.rec ? props.rec.private === true : false));
			var [error, setError] = useState("");
			var [needPw, setNeedPw] = useState(false);
			var [pwInput, setPwInput] = useState("");
			var [pwBusy, setPwBusy] = useState(false);

			var catOptions = (props.cats || []).map(function (c) { return c.name; });
			var editingPrivate = editing && props.rec.private === true;

			var doSave = function () {
				var data = {
					name: String(name).trim(),
					content: String(content),
					category: String(category).trim() || "其他",
					tags: parseTags(tags),
					private: isPrivate,
				};
				var done = editing ? props.updateRecord(props.rec, data) : props.addRecord(data);
				if (done && typeof done.then === "function") {
					done.catch(function () { /* parent shows notice */ });
				}
				if (props.onSaved) props.onSaved();
			};

			var submit = function () {
				if (String(name).trim() === "" || String(content).trim() === "") {
					setError(props.t("required"));
					return;
				}
				if ((isPrivate && !props.unlocked) || (editingPrivate && !props.unlocked)) {
					setNeedPw(true);
					setError("");
					return;
				}
				doSave();
			};

			var verifyThenSave = function () {
				setPwBusy(true);
				setError("");
				props.onUnlockCheck(pwInput).then(function (ok) {
					setPwBusy(false);
					if (!ok) { setError(props.t("unlockFail")); return; }
					if (editingPrivate) setContent(props.onContentOf(props.rec.id));
					setNeedPw(false);
					doSave();
				}).catch(function () {
					setPwBusy(false);
					setError(props.t("unlockFail"));
				});
			};

			return createElement(ModalShell, { title: editing ? props.t("formEdit") : props.t("formAdd"), onClose: props.onClose },
				createElement(Field, { label: props.t("formName") },
					createElement("input", { type: "text", value: name, onChange: function (e) { setName(e.target.value); }, style: inputStyle })),
				createElement(Field, { label: props.t("formContent") },
					editingPrivate && !props.unlocked
						? createElement("textarea", { value: "", placeholder: props.t("contentLocked"), disabled: true, style: textareaStyle, className: "dsh-vault-mono", rows: 4 })
						: createElement("textarea", { value: content, onChange: function (e) { setContent(e.target.value); }, style: textareaStyle, className: "dsh-vault-mono", rows: 4 })),
				createElement(Field, { label: props.t("formCategory") },
					createElement("input", {
						type: "text",
						value: category,
						onChange: function (e) { setCategory(e.target.value); },
						style: inputStyle,
						list: "dsh-vault-cat-list",
						placeholder: "密钥 / 服务器 / 地址 / 手机号 / 网址 / 消息 / 其他",
					}),
					createElement("datalist", { id: "dsh-vault-cat-list" },
						catOptions.map(function (c) { return createElement("option", { key: c, value: c }); })
					)),
				createElement(Field, { label: props.t("formTags"), hint: props.t("formTagsHint") },
					createElement("input", { type: "text", value: tags, onChange: function (e) { setTags(e.target.value); }, style: inputStyle, placeholder: "工作, 生产, 阿里云" })),
				createElement("label", { style: { display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 12.5, color: "var(--dsw-alias-label-secondary)" } },
					createElement("input", {
						type: "checkbox",
						checked: isPrivate,
						onChange: function (e) { setPrivate(e.target.checked); },
						style: { width: 15, height: 15, accentColor: "var(--dsw-alias-brand-primary)", flex: "none" },
					}),
					props.t("formPrivate")
				),
				(isPrivate && !props.unlocked) || (editingPrivate && !props.unlocked)
					? createElement("div", { style: { fontSize: 11, color: "var(--dsw-alias-label-tertiary)" } }, props.t("needPwToSave"))
					: null,
				needPw
					? createElement("div", { style: { display: "flex", gap: 8, alignItems: "flex-end" } },
						createElement("div", { style: { flex: 1 } },
							createElement(Field, { label: props.t("password") }, createElement(PasswordInput, { value: pwInput, onChange: setPwInput, onEnter: verifyThenSave }))),
						createElement(Button, { size: "sm", variant: "outline", disabled: pwBusy || pwInput === "", onClick: verifyThenSave }, pwBusy ? "…" : props.t("verifyPw"))
					)
					: null,
				error !== "" ? createElement("div", { style: { fontSize: 12, color: "var(--dsw-alias-state-error-primary)" } }, error) : null,
				createElement("div", { style: { display: "flex", justifyContent: "flex-end", gap: 8 } },
					createElement(Button, { size: "sm", variant: "ghost", onClick: props.onClose }, props.t("cancel")),
					createElement(Button, { size: "sm", variant: "primary", onClick: submit }, props.t("save"))
				)
			);
		}

		// ---- private gate modal

		function PrivateGateModal(props) {
			var [pw, setPw] = useState("");
			var [busy, setBusy] = useState(false);
			var [error, setError] = useState("");

			var submit = function () {
				setBusy(true);
				setError("");
				props.onUnlockCheck(pw).then(function (ok) {
					setBusy(false);
					try { console.log("[vault:gate] unlock ok=" + ok, "rec=" + (props.rec ? props.rec.id : "?")); } catch (e) { /* ignore */ }
					if (!ok) { setError(props.t("unlockFail")); return; }
					props.onClose();
					if (props.after) props.after();
					else props.fillRecord(props.rec, props.sendNow === true);
				}).catch(function (e) {
					setBusy(false);
					try { console.warn("[vault:gate] unlock threw", e); } catch (err) { /* ignore */ }
					setError(props.t("unlockFail"));
				});
			};

			return createElement(ModalShell, { title: props.t("privateTitle"), onClose: props.onClose },
				createElement("div", { style: { fontSize: 12, color: "var(--dsw-alias-label-tertiary)", lineHeight: 1.6 } }, props.t("privateDesc")),
				createElement(Field, { label: props.t("password") }, createElement(PasswordInput, { value: pw, onChange: setPw, onEnter: submit })),
				error !== "" ? createElement("div", { style: { fontSize: 12, color: "var(--dsw-alias-state-error-primary)" } }, error) : null,
				createElement("div", { style: { display: "flex", justifyContent: "flex-end", gap: 8 } },
					createElement(Button, { size: "sm", variant: "ghost", onClick: props.onClose }, props.t("cancel")),
					createElement(Button, { size: "sm", variant: "primary", disabled: busy || pw === "", onClick: submit }, busy ? "…" : props.t("unlock"))
				)
			);
		}

		// ---- delete confirm modal

		function DeleteModal(props) {
			return createElement(ModalShell, { title: props.t("delete"), onClose: props.onClose },
				createElement("div", { style: { fontSize: 13, color: "var(--dsw-alias-label-secondary)", lineHeight: 1.6 } },
					props.t("confirmDelete", { name: props.rec.name })),
				createElement("div", { style: { display: "flex", justifyContent: "flex-end", gap: 8 } },
					createElement(Button, { size: "sm", variant: "ghost", onClick: props.onClose }, props.t("cancel")),
					createElement(Button, { size: "sm", variant: "primary", onClick: function () { props.deleteRecord(props.rec); } }, props.t("delete"))
				)
			);
		}

		// ---- reset modal (security word)

		function ResetModal(props) {
			var [sec, setSec] = useState("");
			var [pw, setPw] = useState("");
			var [pw2, setPw2] = useState("");
			var [newSec, setNewSec] = useState("");
			var [busy, setBusy] = useState(false);
			var [error, setError] = useState("");

			var submit = function () {
				if (pw.length < 4) { setError(props.t("passwordShort")); return; }
				if (pw !== pw2) { setError(props.t("passwordMismatch")); return; }
				setBusy(true);
				setError("");
				props.onReset(sec, pw, newSec.trim() !== "" ? newSec : undefined).then(function () {
					setBusy(false);
				}).catch(function () {
					setBusy(false);
					setError(props.t("verifyFail"));
				});
			};

			return createElement(ModalShell, { title: props.t("resetTitle"), onClose: props.onClose },
				createElement("div", { style: { fontSize: 12, color: "var(--dsw-alias-label-tertiary)", lineHeight: 1.6 } }, props.t("resetDesc")),
				createElement(Field, { label: props.t("securityWord") }, createElement(PasswordInput, { value: sec, onChange: setSec })),
				createElement(Field, { label: props.t("newPassword") }, createElement(PasswordInput, { value: pw, onChange: setPw })),
				createElement(Field, { label: props.t("confirmPassword") }, createElement(PasswordInput, { value: pw2, onChange: setPw2, onEnter: submit })),
				createElement(Field, { label: props.t("newSecurityWord") }, createElement(PasswordInput, { value: newSec, onChange: setNewSec })),
				error !== "" ? createElement("div", { style: { fontSize: 12, color: "var(--dsw-alias-state-error-primary)" } }, error) : null,
				createElement("div", { style: { display: "flex", justifyContent: "flex-end", gap: 8 } },
					createElement(Button, { size: "sm", variant: "ghost", onClick: props.onClose }, props.t("cancel")),
					createElement(Button, { size: "sm", variant: "primary", disabled: busy || sec === "", onClick: submit }, busy ? "…" : props.t("verify"))
				)
			);
		}

		// ---- suggestions list modal（完整可收录信息列表）

		function SuggestionsModal(props) {
			return createElement(ModalShell, { title: props.t("suggestTitle", { n: props.items.length }), onClose: props.onClose, width: 540 },
				createElement("div", { className: "dsh-vault-scroll", style: { display: "flex", flexDirection: "column", gap: 6, maxHeight: "min(56vh, 430px)", overflowY: "auto", padding: 2 } },
					props.items.length === 0
						? createElement("div", { style: { padding: "26px 12px", textAlign: "center", fontSize: 12.5, color: "var(--dsw-alias-label-tertiary)" } }, props.t("noSearch"))
						: props.items.map(function (item) {
							return createElement("div", { key: item.id, style: { display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: 10, border: "1px solid var(--dsw-alias-border-l1, var(--dsw-alias-border-l2))", background: "var(--dsw-alias-bg-layer-2)" } },
								createElement("span", { style: Object.assign({}, chipStyle, { flex: "none" }) }, item.category),
								createElement("span", { style: { flex: 1, minWidth: 0, fontSize: 11.5, color: "var(--dsw-alias-label-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "ui-monospace,Menlo,Consolas,monospace" } }, item.value),
								createElement(Button, { size: "sm", variant: "primary", style: { flex: "none" }, onClick: function () { props.onRecord(item); } }, props.t("record")),
								createElement(Button, { size: "sm", variant: "ghost", style: { flex: "none" }, onClick: function () { props.onIgnore(item); } }, props.t("ignore"))
							);
						})
				),
				createElement("div", { style: { display: "flex", justifyContent: "flex-end", borderTop: "1px solid var(--dsw-alias-border-l1, var(--dsw-alias-border-l2))", paddingTop: 10 } },
					createElement(Button, { size: "sm", variant: "outline", onClick: props.onIgnoreAll }, props.t("ignoreAll"))
				)
			);
		}

		// ---- settings modal (分区 + 顶部对齐)

		function SettingsBody(props) {
			var [autoDetect, setAutoDetect] = useState(props.autoDetect !== false);
			var [autoLock, setAutoLock] = useState(String(props.autoLockMinutes || 10));
			var [url, setUrl] = useState(props.webdav ? (props.webdav.url || "") : "");
			var [user, setUser] = useState(props.webdav ? (props.webdav.username || "") : "");
			var [pass, setPass] = useState(props.webdav ? (props.webdav.password || "") : "");
			var [backupName, setBackupName] = useState("chicheng-vault-backup.json");
			var [restoreName, setRestoreName] = useState("chicheng-vault-backup.json");
			var [busy, setBusy] = useState("");
			var [error, setError] = useState("");
			var [ok, setOk] = useState("");
			var [unlockPw, setUnlockPw] = useState("");
			var [unlockBusy, setUnlockBusy] = useState(false);
			var [unlockErr, setUnlockErr] = useState("");
			var [localUnlocked, setLocalUnlocked] = useState(!!runtime.key);
			var [resetModal, setResetModal] = useState(false);

			useEffect(function () {
				var cancelled = false;
				var unLocked = runtime.on("locked", function () {
					setLocalUnlocked(false);
					setUrl(""); setUser(""); setPass("");
				});
				if (!runtime.store) {
					api("loadStore").then(function (store) {
						if (cancelled) return;
						runtime.store = store;
						setAutoLock(String((runtime.store && runtime.store.autoLockMinutes) || 10));
					}).catch(function () { /* ignore */ });
				}
				return function () { cancelled = true; unLocked(); };
			}, []);

			useEffect(function () {
				if (props.webdav) {
					setUrl(props.webdav.url || "");
					setUser(props.webdav.username || "");
					setPass(props.webdav.password || "");
				}
			}, [props.webdav]);

			var saveAutoDetect = function (value) {
				setAutoDetect(value);
				props.onSetAutoDetect(value);
			};

			var saveAutoLock = function (value) {
				var minutes = Math.max(0, Math.min(1440, Math.round(Number(value) || 0)));
				setAutoLock(String(minutes));
				props.onSetAutoLock(minutes);
			};

			var doUnlock = function () {
				setUnlockBusy(true);
				setUnlockErr("");
				unlockVault(unlockPw).then(function () {
					setUnlockBusy(false);
					setUnlockPw("");
					setLocalUnlocked(true);
					if (runtime.webdav) {
						setUrl(runtime.webdav.url || "");
						setUser(runtime.webdav.username || "");
						setPass(runtime.webdav.password || "");
					}
				}).catch(function () {
					setUnlockBusy(false);
					setUnlockErr(props.t("unlockFail"));
				});
			};

			var saveWebdav = function () {
				if (String(url).trim() === "") { setError(props.t("webdavUrlRequired")); return; }
				setOk("");
				setError("");
				setBusy("save");
				if (!runtime.key) { setError(props.t("webdavLocked")); setBusy(""); return; }
				runtime.webdav = { url: String(url).trim(), username: String(user).trim(), password: pass };
				recordEncrypt(runtime.key, JSON.stringify(runtime.webdav)).then(function (blob) {
					if (!runtime.store) throw new Error("no-store");
					runtime.store.webdav = blob;
					return saveStoreToHost();
				}).then(function () {
					setOk(props.t("webdavSaved"));
				}).catch(function (e) {
					setError(String((e && e.message) || "error"));
				}).finally(function () { setBusy(""); });
			};

			var doBackup = function () {
				if (!runtime.webdav || String(runtime.webdav.url).trim() === "") { setError(props.t("webdavUrlRequired")); return; }
				var filename = String(backupName).trim() || "chicheng-vault-backup.json";
				setBusy("backup");
				setOk("");
				setError("");
				api("webdav", {
					url: String(runtime.webdav.url).trim().replace(/\/+$/, "") + "/" + filename,
					method: "PUT",
					body: JSON.stringify(runtime.store),
					username: String(runtime.webdav.username || "").trim(),
					password: runtime.webdav.password || "",
				}).then(function (res) {
					if (!res.ok) throw new Error((res.statusText || "HTTP " + res.status) + (res.body ? " " + String(res.body).slice(0, 200) : ""));
					setOk(props.t("backupOk"));
				}).catch(function (e) {
					setError(props.t("backupFail") + ": " + ((e && e.message) || ""));
				}).finally(function () { setBusy(""); });
			};

			var doRestore = function () {
				if (!runtime.webdav || String(runtime.webdav.url).trim() === "") { setError(props.t("webdavUrlRequired")); return; }
				if (!window.confirm(props.t("restoreConfirm"))) return;
				var filename = String(restoreName).trim() || "chicheng-vault-backup.json";
				setBusy("restore");
				setOk("");
				setError("");
				api("webdav", {
					url: String(runtime.webdav.url).trim().replace(/\/+$/, "") + "/" + filename,
					method: "GET",
					username: String(runtime.webdav.username || "").trim(),
					password: runtime.webdav.password || "",
				}).then(function (res) {
					if (!res.ok) throw new Error("HTTP " + (res.status || res.statusText || "?"));
					var store = JSON.parse(res.body);
					if (!store || store.wrapPw === undefined) throw new Error("invalid backup");
					return api("saveStore", { store: store }).then(function () { return store; });
				}).then(function (store) {
					runtime.store = store;
					lockVault();
					setLocalUnlocked(false);
					setUrl(""); setUser(""); setPass("");
					setOk(props.t("restoredNote"));
				}).catch(function (e) {
					setError((e && e.message) || props.t("restoreFail"));
				}).finally(function () { setBusy(""); });
			};

			var [curPw, setCurPw] = useState("");
			var [newPw, setNewPw] = useState("");
			var [newPw2, setNewPw2] = useState("");
			var [pwMsg, setPwMsg] = useState("");

			var doChangePw = function () {
				if (newPw.length < 4) { setPwMsg(props.t("passwordShort")); return; }
				if (newPw !== newPw2) { setPwMsg(props.t("passwordMismatch")); return; }
				setPwMsg("");
				changePassword(curPw, newPw).then(function () {
					setPwMsg(props.t("pwChanged"));
					setCurPw(""); setNewPw(""); setNewPw2("");
				}).catch(function () {
					setPwMsg(props.t("changeFail"));
				});
			};

			var doResetInternal = function (sec, npw, nsec) {
				return resetWithSecurityWord(sec, npw, nsec).then(function () {
					setResetModal(false);
					setPwMsg(props.t("pwChanged"));
					setLocalUnlocked(true);
					if (runtime.webdav) {
						setUrl(runtime.webdav.url || "");
						setUser(runtime.webdav.username || "");
						setPass(runtime.webdav.password || "");
					}
				}).catch(function () {
					throw new Error("verify-fail");
				});
			};

			var checkbox = { width: 15, height: 15, accentColor: "var(--dsw-alias-brand-primary)", flex: "none", marginTop: 2 };

			return createElement(React.Fragment, null,
				// 自动识别
				createElement("div", { style: sectionStyle },
					createElement("label", { style: { display: "flex", alignItems: "flex-start", gap: 8, cursor: "pointer" } },
						createElement("input", {
							type: "checkbox",
							checked: autoDetect,
							onChange: function (e) { saveAutoDetect(e.target.checked); },
							style: checkbox,
						}),
						createElement("div", { style: { display: "flex", flexDirection: "column", gap: 2 } },
							createElement("span", { style: sectionTitleStyle }, props.t("secAutoDetect")),
							createElement("span", { style: sectionDescStyle }, props.t("autoDetectDesc"))
						)
					)
				),
				// 自动锁定
				createElement("div", { style: sectionStyle },
					createElement("span", { style: sectionTitleStyle }, props.t("secAutoLock")),
					createElement("span", { style: sectionDescStyle }, props.t("secAutoLockDesc")),
					createElement("div", { style: { display: "flex", alignItems: "center", gap: 8 } },
						createElement("input", {
							type: "number",
							min: 0,
							max: 1440,
							value: autoLock,
							onChange: function (e) { setAutoLock(e.target.value); },
							onBlur: function (e) { saveAutoLock(e.target.value); },
							onKeyDown: function (e) { if (e.key === "Enter") saveAutoLock(e.target.value); },
							style: Object.assign({}, inputStyle, { width: 110 }),
						}),
						createElement("span", { style: { fontSize: 11.5, color: "var(--dsw-alias-label-tertiary)" } }, t("autoLock"))
					)
				),
				// WebDAV 备份
				createElement("div", { style: sectionStyle },
					createElement("span", { style: sectionTitleStyle }, props.t("webdav")),
					createElement("span", { style: sectionDescStyle }, localUnlocked ? props.t("webdavDesc") : props.t("webdavLocked")),
					!localUnlocked
						? createElement("div", { style: { display: "flex", gap: 8, alignItems: "flex-end" } },
							createElement("div", { style: { flex: 1 } },
								createElement(Field, { label: props.t("password") }, createElement(PasswordInput, { value: unlockPw, onChange: setUnlockPw, onEnter: doUnlock }))),
							createElement(Button, { size: "sm", variant: "outline", disabled: unlockBusy || unlockPw === "", onClick: doUnlock }, unlockBusy ? "…" : props.t("unlock"))
						)
						: createElement("div", { style: { display: "flex", flexDirection: "column", gap: 10 } },
							createElement(Field, { label: props.t("webdavUrl") },
								createElement("input", { type: "text", value: url, onChange: function (e) { setUrl(e.target.value); }, style: inputStyle, placeholder: "https://dav.jianguoyun.com/dav/" })),
							createElement("div", { style: { display: "flex", gap: 8 } },
								createElement(Field, { label: props.t("webdavUser") },
									createElement("input", { type: "text", value: user, onChange: function (e) { setUser(e.target.value); }, style: inputStyle })),
								createElement(Field, { label: props.t("webdavPass") },
									createElement("input", { type: "password", value: pass, onChange: function (e) { setPass(e.target.value); }, style: inputStyle }))
							),
							createElement("div", { style: { display: "flex", gap: 8, alignItems: "center" } },
								createElement(Button, { size: "sm", variant: "outline", disabled: busy !== "", onClick: saveWebdav }, props.t("save")),
								createElement(Button, { size: "sm", variant: "primary", disabled: busy !== "", onClick: doBackup }, busy === "backup" ? "…" : props.t("backup"))
							),
							createElement(Field, { label: props.t("backupName"), hint: props.t("restoreHint") },
								createElement("input", { type: "text", value: backupName, onChange: function (e) { setBackupName(e.target.value); }, style: inputStyle })),
							createElement(Field, { label: props.t("restore") },
								createElement("div", { style: { display: "flex", gap: 8 } },
									createElement("input", { type: "text", value: restoreName, onChange: function (e) { setRestoreName(e.target.value); }, style: Object.assign({}, inputStyle, { flex: 1 }) }),
									createElement(Button, { size: "sm", variant: "outline", disabled: busy !== "", onClick: doRestore }, busy === "restore" ? "…" : props.t("restore"))
								))
						),
					unlockErr !== "" ? createElement("div", { style: { fontSize: 12, color: "var(--dsw-alias-state-error-primary)" } }, unlockErr) : null
				),
				// 修改密码
				createElement("div", { style: sectionStyle },
					createElement("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 } },
						createElement("span", { style: sectionTitleStyle }, props.t("changePw")),
						createElement("button", {
							type: "button",
							onClick: function () { setResetModal(true); },
							style: { border: "none", background: "transparent", color: "var(--dsw-alias-brand-primary)", fontSize: 11.5, cursor: "pointer", padding: 0 },
						}, props.t("forgot"))
					),
					createElement("span", { style: sectionDescStyle }, props.t("changePwDesc")),
					createElement(Field, { label: props.t("currentPw") }, createElement(PasswordInput, { value: curPw, onChange: setCurPw })),
					createElement("div", { style: { display: "flex", gap: 8 } },
						createElement(Field, { label: props.t("newPassword") }, createElement(PasswordInput, { value: newPw, onChange: setNewPw })),
						createElement(Field, { label: props.t("confirmNewPw") }, createElement(PasswordInput, { value: newPw2, onChange: setNewPw2, onEnter: doChangePw }))
					),
					pwMsg !== "" ? createElement("div", { style: { fontSize: 12, color: pwMsg === props.t("pwChanged") ? "var(--dsw-alias-state-success-primary)" : "var(--dsw-alias-state-error-primary)" } }, pwMsg) : null,
					createElement("div", { style: { display: "flex", justifyContent: "flex-end" } },
						createElement(Button, { size: "sm", variant: "outline", onClick: doChangePw }, props.t("change")))
				),
				ok !== "" ? createElement("div", { style: { fontSize: 12, color: "var(--dsw-alias-state-success-primary)" } }, ok) : null,
				error !== "" ? createElement("div", { style: { fontSize: 12, color: "var(--dsw-alias-state-error-primary)", wordBreak: "break-all" } }, error) : null,
				resetModal
					? createElement(ResetModal, {
						t: props.t,
						onClose: function () { setResetModal(false); },
						onReset: doResetInternal,
					})
					: null
			);
		}

		// ---- 设置页分区（DSH Settings → 保险箱；导航图标为闪电，寓意「便捷输入」）

		function SettingsSection(props) {
			var [tick, setTick] = useState(0);
			var refresh = function () { setTick(function (n) { return n + 1; }); };

			useEffect(function () {
				var cancelled = false;
				var unLocked = runtime.on("locked", refresh);
				var unStatus = runtime.on("status", refresh);
				if (!runtime.store) {
					api("loadStore").then(function (store) {
						if (cancelled) return;
						runtime.store = store;
						refresh();
					}).catch(function () { /* ignore */ });
				}
				// 设置页左侧导航行的图标：默认齿轮 → 闪电（便捷输入）
				var patchNavIcon = function () {
					try {
						var label = t("settingsNav");
						var buttons = document.querySelectorAll('[role="dialog"] button');
						var NS = "http://www.w3.org/2000/svg";
						for (var i = 0; i < buttons.length; i += 1) {
							var button = buttons[i];
							if ((button.textContent || "").trim() !== label) continue;
							if (button.querySelector("svg[data-dsh-vault-nav]")) continue;
							var svg = button.querySelector("svg");
							if (!svg) continue;
							var replacement = document.createElementNS(NS, "svg");
							replacement.setAttribute("data-dsh-vault-nav", "");
							replacement.setAttribute("width", "16");
							replacement.setAttribute("height", "16");
							replacement.setAttribute("viewBox", "0 0 16 16");
							replacement.setAttribute("fill", "currentColor");
							replacement.setAttribute("aria-hidden", "true");
							var cls = svg.getAttribute("class");
							if (cls) replacement.setAttribute("class", cls);
							var path = document.createElementNS(NS, "path");
							path.setAttribute("d", "M9.2 1 3.4 8.6h3.4l-1 6.4 5.8-7.6H8.2l1-6.4z");
							replacement.appendChild(path);
							svg.parentNode.replaceChild(replacement, svg);
						}
					} catch (e) { /* ignore */ }
				};
				patchNavIcon();
				var iv = setInterval(patchNavIcon, 1500);
				return function () { cancelled = true; unLocked(); unStatus(); clearInterval(iv); };
			}, []);

			return createElement("div", { style: { padding: "2px 2px 24px", display: "flex", flexDirection: "column", gap: 12 } },
				createElement("div", { style: { fontSize: 16, fontWeight: 700, color: "var(--dsw-alias-label-primary)" } }, t("settingsNav") + " · " + t("settings")),
				createElement("div", { style: { fontSize: 12, color: "var(--dsw-alias-label-tertiary)", lineHeight: 1.6 } }, t("settingsHint")),
				createElement(SettingsBody, {
					t: t,
					autoDetect: runtime.status ? runtime.status.autoDetect !== false : true,
					autoLockMinutes: (runtime.store && runtime.store.autoLockMinutes) || 10,
					webdav: runtime.webdav,
					onSetAutoDetect: function (value) {
						api("saveConfig", { autoDetect: value }).catch(function () {});
					},
					onSetAutoLock: function (minutes) {
						if (!runtime.store) return;
						runtime.store.autoLockMinutes = minutes;
						saveStoreToHost().catch(function () {});
					},
				})
			);
		}

		// ---- setup-done modal (one-time security word display)

		function SetupDoneModal(props) {
			return createElement(ModalShell, { title: props.t("setupDone"), onClose: props.onClose },
				createElement("div", { style: { fontSize: 12, color: "var(--dsw-alias-label-tertiary)", lineHeight: 1.6 } }, props.t("setupDoneDesc")),
				createElement("div", { style: { fontSize: 16, fontWeight: 700, color: "var(--dsw-alias-brand-primary)", padding: "10px 12px", borderRadius: 10, background: "var(--dsw-alias-bg-layer-2)", border: "1px dashed var(--dsw-alias-border-l2)", textAlign: "center", wordBreak: "break-all" } },
					props.securityWord),
				createElement("div", { style: { fontSize: 12, color: "var(--dsw-alias-state-error-primary)", lineHeight: 1.6 } }, props.t("setupDoneWarn")),
				createElement("div", { style: { display: "flex", justifyContent: "flex-end" } },
					createElement(Button, { size: "md", variant: "primary", onClick: props.onClose }, props.t("start")))
			);
		}

		// ---- modal router

		function renderModals(modal, m) {
			if (!modal) return null;
			switch (modal.kind) {
				case "add":
					return createElement(RecordFormModal, {
						t: m.t,
						cats: m.records,
						unlocked: m.unlocked,
						preset: modal.preset,
						onSaved: modal.onSaved,
						onClose: function () { m.setModal(null); },
						addRecord: m.addRecord,
						onUnlockCheck: m.doVerify,
						onContentOf: m.onContentOf,
					});
				case "edit":
					return createElement(RecordFormModal, {
						t: m.t,
						cats: m.records,
						unlocked: m.unlocked,
						rec: modal.rec,
						initialContent: modal.rec.private === true ? m.onContentOf(modal.rec.id) : modal.rec.content,
						onClose: function () { m.setModal(null); },
						updateRecord: m.updateRecord,
						onUnlockCheck: m.doVerify,
						onContentOf: m.onContentOf,
					});
				case "confirm":
					return createElement(DeleteModal, {
						t: m.t,
						rec: modal.rec,
						onClose: function () { m.setModal(null); },
						deleteRecord: m.deleteRecord,
					});
				case "private":
				case "privateFirst":
					return createElement(PrivateGateModal, {
						t: m.t,
						rec: modal.rec,
						sendNow: modal.sendNow,
						after: modal.after,
						onUnlockCheck: m.doVerify,
						onClose: function () { m.setModal(null); },
						fillRecord: m.fillRecord,
					});
				case "reset":
					return createElement(ResetModal, {
						t: m.t,
						onClose: function () { m.setModal(null); },
						onReset: m.doReset,
					});
				case "suggestions":
					return createElement(SuggestionsModal, {
						t: m.t,
						items: m.suggestions || [],
						onClose: function () { m.setModal(null); },
						onRecord: m.recordFromSuggestion,
						onIgnore: m.ignoreSuggestion,
						onIgnoreAll: m.ignoreAllSuggestions,
					});
				case "setupDone":
					return createElement(SetupDoneModal, {
						t: m.t,
						securityWord: modal.securityWord,
						onClose: function () { m.setModal(null); },
					});
				default:
					return null;
			}
		}

		// ============================================================ plugin surface

		var inject = ["slots"];

		function apply(ctx) {
			ctx.effect(function () {
				ensureStyleEl();
				startPolling();

				// 自动锁定：解锁状态下无操作超过 autoLockMinutes 即重新锁定私密内容
				var lastActivity = Date.now();
				var bump = function () { lastActivity = Date.now(); };
				var check = function () {
					if (!runtime.key || !runtime.store) return;
					var minutes = Number(runtime.store.autoLockMinutes);
					if (!minutes || minutes <= 0) return;
					if (Date.now() - lastActivity > minutes * 60000) lockVault(t("autoLocked"));
				};
				var iv = setInterval(check, 15000);
				window.addEventListener("pointerdown", bump);
				window.addEventListener("keydown", bump);

				return function () {
					stopPolling();
					clearInterval(iv);
					window.removeEventListener("pointerdown", bump);
					window.removeEventListener("keydown", bump);
				};
			}, "chicheng-vault: runtime");

			ctx.slots.inject("conversation.input.right", function () {
				return ctx.slots.register({
					name: "conversation.input.right",
					id: "chicheng-vault",
					order: 90,
					label: function () { return t("nav"); },
				}, VaultTrigger);
			});

			// DSH 设置页面分区（左侧栏「设置」→ 便捷输入），导航图标为闪电
			ctx.slots.inject("settings.section", function () {
				return ctx.slots.register({
					name: "settings.section",
					id: "chicheng-vault",
					order: 80,
					label: function () { return t("settingsNav"); },
				}, SettingsSection);
			});

			try { console.info("[chicheng-vault] client ready"); } catch (e) { /* ignore */ }
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
