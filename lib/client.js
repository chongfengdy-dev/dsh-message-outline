window.__ModuleLoader__.load({
	id: "dsh-message-outline",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;

		// ============================================================
		// dsh-message-outline — 当前会话消息大纲（左缘横杠），独立自 term-panels
		// 纯前端：sessions 快照订阅驱动，零 3081 依赖，零轮询。
		// ============================================================
					// ========== 左缘消息大纲条（当前会话我的消息，hover 展开） ==========
			// 2026-08-17 主定稿（单元素设计，v1 基底）：横杠即面板——平时一列细横杠
			// （每条=我的一条消息），hover 同一元素展开为完整大纲（横杠+行号+文本同一行，
			// 天然垂直对齐）；位置：对话区滚动容器左内缘+4；最多显示 10 条（最近 10 条，
			// 最新在下），多于 10 条展开时 box 内滚动条上下查找；
			// 颜色：默认灰、鼠标划过整行变黑（横杠+文字）、点击行→横杠+文字变蓝并瞬间定位；
			// 字体 14px；数据源 sessions.binding(id).session 快照（订阅驱动，不轮询不重建）；
			// DOM 定位：data-chat-flow-kind="user" 第 n 行 = 第 n 条我的消息（dsh 渲染契约）。
			const OUTLINE_RAIL_ID = "dsh-msg-outline-rail";
			const OUTLINE_FLASH = "dsh-msg-outline-flash";
	
			function buildMessageOutline(ctx) {
				const sessions = ctx.sessions || (ctx.get ? ctx.get("sessions") : undefined);
				if (!sessions) return;
				if (document.getElementById(OUTLINE_RAIL_ID)) return; // 已注入
	
				// ---- 单元素：横杠列 = 大纲面板（hover 同一元素展开） ----
				const box = document.createElement("div");
				box.id = OUTLINE_RAIL_ID;
				Object.assign(box.style, {
					position: "fixed", left: "0", top: "50%",
					transform: "translateY(-50%)", zIndex: "99989",
					display: "flex", flexDirection: "column", gap: "0",
					padding: "6px", borderRadius: "10px",
					background: "transparent", border: "1px solid transparent",
					cursor: "pointer",
					transition: "background .15s ease, border-color .15s ease",
					maxHeight: "260px", overflowY: "auto",
					fontSize: "14px",
					visibility: "hidden", // 定位到对话区左内缘前不显示
				});
	
				// ---- 状态 ----
				let sessionId = null;
				let binding = null;      // { session: { getSnapshot, subscribe } }
				let unsubscribe = null;  // 当前会话订阅退订函数（会话切换时释放）
				let userMsgs = [];       // [{text, key}]（我的消息，key=官方锚点，快照全量同步）
				let activeIdx = -1;      // 当前点击/选中的消息下标（-1=无，横杠+文字变蓝）
				let rows = [];           // {row, bar, num, txt, idx} 行引用（颜色状态更新用）
				let expanded = false;    // 是否展开（平时只显示横杠，hover 展开显示行号+文本）
	
				function currentSessionId() {
					const snap = sessions.list && sessions.list.getSnapshot ? sessions.list.getSnapshot() : null;
					return snap && snap.current !== undefined ? snap.current : null;
				}
	
				function rebind() {
					const sid = currentSessionId();
					if (sid === sessionId && binding) return;
					// 会话切换：退订旧会话订阅，重新绑定新会话
					if (unsubscribe) { try { unsubscribe(); } catch (e) {} unsubscribe = null; }
					sessionId = sid;
					if (sid === null) { binding = null; userMsgs = []; rows = []; renderRows(); return; }
					userMsgs = [];
					rows = [];
					try { binding = sessions.binding(sid); } catch (e) { binding = null; }
					if (binding && binding.session && binding.session.subscribe) {
						try { unsubscribe = binding.session.subscribe(onSessionEvent); } catch (e) {}
					}
					renderRows();
					// 快照全量同步（含全部历史，按时间序；重启后对话区自动加载历史，快照=全部）
					onSessionEvent();
				}
	
				// 快照全量同步：快照 = 对话区已加载全部消息。用官方 chat.order（渲染顺序 key 列表）
				// + chat.nodes（key→节点）：user 消息按 order 序收集 {text, key}，整体替换列表。
				// key 是官方唯一锚点（DOM data-chat-anchor-key），跳转用 key 定位，零文本匹配。
				function onSessionEvent() {
					if (!binding || !binding.session) return;
					let list = [];
					let snapHasMore = false;
					try {
						const snap = binding.session.getSnapshot();
						snapHasMore = !!(snap && snap.hasMore);
						const chat = (snap && snap.chat) || null;
						const order = chat && chat.order;
						const nodes = chat && chat.nodes;
						if (Array.isArray(order) && nodes && typeof nodes.get === "function") {
							for (const key of order) {
								const node = nodes.get(key);
								if (!node) continue;
								if (node.kind !== "user" && node.kind !== "steering") continue;
								const t = nodeTextOf(node);
								if (!t) continue;
								list.push({ text: t, key });
							}
						}
					} catch (e) { return; }
					// 整体替换（key 去重）
					const next = [];
					const seen = new Set();
					for (const m of list) {
						if (seen.has(m.key)) continue;
						seen.add(m.key);
						next.push(m);
					}
					let changed = next.length !== userMsgs.length;
					if (!changed) {
						for (let i = 0; i < next.length; i++) {
							if (next[i].key !== userMsgs[i].key) { changed = true; break; }
						}
					}
					if (changed) {
						userMsgs = next;
						renderRows();
					}
					rebuildRowMap();
					// 加载历史期间隐藏行号（序号整体前移会跳），加载完成（hasMore=false）再显示
					numHiddenByLoad = !!snapHasMore;
					updateExpanded(expanded);
					// 还有更早历史 → 继续加载（loadOlder 分页；DOM 变化会再触发 sync）
					if (snapHasMore) maybeLoadOlder();
				}
	
				// key → DOM 行索引：数据/DOM 变化时重建。key 是官方锚点（data-chat-anchor-key），
				// 直接按属性查 DOM 行，零文本匹配、零数量对齐、零顺序假设——最可靠。
				let keyMap = {};
				let rowObserver = null;
				let pendingTarget = null;   // 懒加载定位目标：点击后等待"加载更早"把目标加载进 DOM
				let lastLoadClick = 0;      // 触发"加载更早"节流
				let pendingTimer = null;    // 定位超时保护
				function rebuildRowMap() {
					keyMap = {};
					const root = findChatRoot();
					if (!root) return;
					// 直接按官方 key 属性建索引：data-chat-anchor-key → 行元素
					const els = root.querySelectorAll('[data-chat-anchor-key]');
					for (const e of els) {
						const k = e.getAttribute("data-chat-anchor-key");
						if (k) keyMap[k] = e;
					}
					// 懒加载定位：目标刚被加载出来 → 立即定位
					if (pendingTarget && keyMap[pendingTarget]) {
						const el = keyMap[pendingTarget];
						pendingTarget = null;
						clearTimeout(pendingTimer);
						if (el) jumpTo(el);
						return;
					}
					// 目标还没出现 → 继续触发"加载更早"（有更早按钮且非加载中）
					if (pendingTarget) maybeLoadOlder();
				}
				// 从快照节点提取首行文本（参考 dsh-chat-outline：文本在 node.data.content）
				function nodeTextOf(node) {
					if (!node) return "";
					const blocks = (node.data && node.data.content) || node.content || node.blocks || [];
					let text = "";
					for (const b of blocks) {
						if ((b.type === "text" || b.kind === "text") && typeof b.text === "string") {
							text += b.text + "\n";
						}
					}
					return text.trim().split("\n", 1)[0] || "";
				}
				// 触发对话区"加载更早"（懒加载历史）：优先走官方 binding.session.loadOlder()
				// 编程式分页加载（dsh 官方 ChatView 按钮同机制），节流防止连点。
				function maybeLoadOlder() {
					if (binding && binding.session && typeof binding.session.loadOlder === "function") {
						const now = Date.now();
						if (now - lastLoadClick < 600) return;
						lastLoadClick = now;
						try { binding.session.loadOlder().catch(() => {}); } catch (e) {}
						return;
					}
					// 兜底：模拟点击"加载更早"按钮
					const root = findChatRoot();
					if (!root) return;
					const btn = root.querySelector('button[type="button"]');
					if (!btn || btn.disabled) return;
					const label = (btn.textContent || "").trim();
					if (label !== "加载更早" && label !== "Load earlier") return;
					const now = Date.now();
					if (now - lastLoadClick < 600) return;
					lastLoadClick = now;
					btn.click();
				}
				// 监听对话区 DOM 变化（新消息渲染 / 点击"加载更早"加载历史 / compaction 重建），
				// 变化即重建索引（防抖），保证横杠点击总能找到最新行号。
				function ensureRowObserver() {
					const root = findChatRoot();
					if (!root || rowObserver) return;
					rowObserver = new MutationObserver(() => {
						clearTimeout(rebuildTimer);
						rebuildTimer = setTimeout(rebuildRowMap, 150);
					});
					rowObserver.observe(root, { childList: true, subtree: true });
				}
				let rebuildTimer = null;
				// 占位条不算记录、点击不定位。
				function renderRows() {
					while (box.children.length) box.removeChild(box.lastChild);
					rows = [];
					if (!userMsgs.length) {
						const ph = document.createElement("div");
						ph.style.cssText = "flex:none;width:14px;height:2px;border-radius:1px;background:var(--dsw-alias-border-l3);opacity:.5;margin:0 4px";
						ph.title = "我的消息（等待新消息…）";
						box.appendChild(ph);
						updateExpanded(expanded);
						return;
					}
					userMsgs.forEach((m, i) => {
						const r = buildRow(m, i);
						box.appendChild(r.row);
						rows.push(r);
					});
					updateExpanded(expanded);
					applyActive();
				}
	
				// 构建一行：横杠 + 行号 + 文本（同一行垂直对齐；hover 整行变黑，点击变蓝）
				// m = { text, key }；key 是官方锚点（data-chat-anchor-key），点击用 key 定位。
				function buildRow(m, idx) {
					const text = m && m.text ? m.text : String(m || "");
					const key = m && m.key;
					const row = document.createElement("div");
					row.style.cssText = "display:flex;align-items:center;gap:8px;min-height:20px;padding:3px 4px;border-radius:6px;cursor:pointer;transition:background .12s ease";
					if (key) row.dataset.msgKey = key;
					const bar = document.createElement("div");
					bar.style.cssText = "flex:none;width:14px;height:2px;border-radius:1px;background:var(--dsw-alias-border-l3);transition:background .12s ease";
					const num = document.createElement("span");
					num.style.cssText = "flex:none;font-family:Consolas,monospace;font-size:12px;min-width:22px;text-align:right;color:var(--dsw-alias-label-tertiary);display:none";
					num.textContent = String(idx + 1);
					const txt = document.createElement("span");
					txt.style.cssText = "flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:none;color:var(--dsw-alias-label-secondary);font-size:14px";
					const short = text.length > 60 ? text.slice(0, 60) + "…" : text;
					txt.textContent = short;
					row.appendChild(bar);
					row.appendChild(num);
					row.appendChild(txt);
					// hover：整行变黑（横杠+文字）+ 更暗的行背景（15%，主 2026-08-17 定稿）
					row.addEventListener("mouseenter", () => {
						row.style.background = "color-mix(in srgb, var(--dsw-alias-label-primary) 15%, transparent)";
						bar.style.background = "var(--dsw-alias-label-primary)";
						num.style.color = "var(--dsw-alias-label-primary)";
						txt.style.color = "var(--dsw-alias-label-primary)";
					});
					row.addEventListener("mouseleave", () => {
						row.style.background = "transparent";
						applyActive();
					});
					row.addEventListener("click", () => scrollToMessage(idx));
					return { row, bar, num, txt, idx };
				}
	
				// 颜色状态：点击选中 = 蓝（横杠+文字），其余 = 灰
				function applyActive() {
					for (const r of rows) {
						const on = r.idx === activeIdx;
						r.bar.style.background = on
							? "var(--dsw-alias-state-business-primary)"   // 点击选中 = 蓝
							: "var(--dsw-alias-border-l3)";               // 默认 = 灰
						r.num.style.color = on
							? "var(--dsw-alias-state-business-primary)"
							: "var(--dsw-alias-label-tertiary)";
						r.txt.style.color = on
							? "var(--dsw-alias-state-business-primary)"
							: "var(--dsw-alias-label-secondary)";
					}
				}
	
				// ---- hover 展开 / 收起（同一元素：横杠列 ↔ 完整大纲；只切样式不重建） ----
				// 收起：只显示横杠（行号/文字隐藏）；展开：bar+num+txt 全显示。
				// 用 mouseover/mouseout 冒泡（子元素都触发，热区可靠），收起态 min-width 保证可 hover。
				// num 显隐 = 展开 && 非"加载历史中"（加载时隐藏行号，完成再显示）
				let numHiddenByLoad = false;
				let savedScrollTop = null;   // 收起（鼠标离开）时的面板滚动位置，重新展开时原样还原
				let collapsedWin = null;     // 收起时的可见行窗口（展开面板当前视口），收起态按它显示 10 条
				// 捕获当前可见行窗口：以吸附到行边界的起点开始，恰好 10 条（与展开视口严格对应）
				function captureVisibleWindow() {
					if (!rows.length) return null;
					const rowH = rows[0].row.offsetHeight || 26;
					const start = Math.max(0, Math.min(rows.length - 1, Math.round(box.scrollTop / rowH)));
					const end = Math.min(rows.length - 1, start + 9);
					return { start, end, rowH };
				}
				function updateExpanded(on) {
					const wasExpanded = expanded;
					if (expanded && !on) {
						// 离开前记住：面板滚动位置 + 当前可见行窗口（收起态显示这 10 条，蓝条停在激活消息槽位）
						savedScrollTop = box.scrollTop;
						collapsedWin = captureVisibleWindow();
					}
					expanded = on;
					box.style.background = on
						? "color-mix(in srgb, var(--dsw-alias-bg-layer-2) 96%, transparent)"
						: "transparent";
					box.style.borderColor = on ? "var(--dsw-alias-border-l2)" : "transparent";
					box.style.boxShadow = on ? "0 8px 24px rgba(0,0,0,.25)" : "none";
					box.style.backdropFilter = on ? "blur(8px)" : "none";
					box.style.width = on ? "320px" : "auto";
					box.style.minWidth = on ? "" : "30px";   // 收起态保证可 hover 热区
					box.style.overflowY = on ? "auto" : "hidden";   // 收起态无滚动条
					box.style.maxHeight = on ? "260px" : "";   // 收起态按内容自适应（10 条完整显示）
					// 收起态 = 展开面板当前视口的 10 条窗口（从未展开过则默认最近 10 条）；
					// 蓝条停在激活消息在窗口内的槽位（applyActive 上色）；展开态 = 全部行
					const winStart = collapsedWin ? collapsedWin.start : Math.max(0, userMsgs.length - 10);
					const winEnd = collapsedWin ? collapsedWin.end : userMsgs.length - 1;
					for (const r of rows) {
						const inWin = r.idx >= winStart && r.idx <= winEnd;
						r.row.style.display = (on || inWin) ? "flex" : "none";
						r.num.style.display = (on && !numHiddenByLoad) ? "" : "none";
						r.txt.style.display = on ? "" : "none";
					}
					// 只在"收起→展开"的瞬间还原上次离开时的滚动位置（不居中、不跳底部），
					// 并吸附到行边界（与 captureVisibleWindow 同一取整规则）——收起/展开的横杠严格对齐，不差半格
					if (on && !wasExpanded) {
						requestAnimationFrame(() => {
							requestAnimationFrame(() => {
								const rowH = collapsedWin ? collapsedWin.rowH : (rows.length ? rows[0].row.offsetHeight : 26);
								const target = savedScrollTop != null ? savedScrollTop : box.scrollHeight;
								box.scrollTop = Math.round(target / rowH) * rowH;
							});
						});
					}
				}
				box.addEventListener("mouseover", () => updateExpanded(true));
				box.addEventListener("mouseout", (e) => {
					if (!box.contains(e.relatedTarget)) updateExpanded(false);
				});
	
				// ---- 位置：对话区滚动容器左内缘+4（resize 时更新，不轮询） ----
				function placeOutline() {
					const root = findChatRoot();
					if (!root) return;
					const container = findScrollContainer(root) || root;
					try {
						const r = container.getBoundingClientRect();
						if (r.width > 0) {
							box.style.left = Math.max(0, r.left + 4) + "px";
							box.style.visibility = "visible";
						}
					} catch (e) {}
				}
	
				// ---- DOM 定位（data-chat-flow-kind="user" 第 n 行 = 第 n 条我的消息） ----
				function findChatRoot() {
					return document.querySelector('[data-slot="conversation"]');
				}
				function findScrollContainer(root) {
					const first = root.querySelector("[data-chat-flow-kind]");
					let cur = first ? first.parentElement : null;
					while (cur && cur !== document.body) {
						const s = getComputedStyle(cur);
						if (cur.scrollHeight > cur.clientHeight && /(auto|scroll|overlay)/.test(s.overflowY)) return cur;
						cur = cur.parentElement;
					}
					return null;
				}
				function scrollToMessage(userIndex) {
					activeIdx = userIndex;
					applyActive();
					const m = userMsgs[userIndex];
					if (!m) return;
					const key = m.key;
					// 官方 key 定位：keyMap 已按 data-chat-anchor-key 建好（数据/DOM 变化时重建）
					if (key && keyMap[key]) { jumpTo(keyMap[key]); return; }
					// 目标不在 DOM（对话区懒加载，"加载更早"的历史还没加载）：
					// 设 pendingTarget（key），触发"加载更早"循环直到目标出现（rebuildRowMap 里续推）
					pendingTarget = key;
					clearTimeout(pendingTimer);
					pendingTimer = setTimeout(() => { pendingTarget = null; }, 15000); // 15s 超时放弃
					maybeLoadOlder();
				}
	
				// 滚动到目标消息行（瞬间定位 + 黄色闪烁）
				function jumpTo(el) {
					if (!el) return;
					const root = findChatRoot();
					const container = root ? findScrollContainer(root) : null;
					if (container) {
						const cr = container.getBoundingClientRect();
						const tr = el.getBoundingClientRect();
						container.scrollTo({ top: container.scrollTop + tr.top - cr.top - 12 });
					} else {
						el.scrollIntoView({ block: "start" });
					}
					el.classList.add(OUTLINE_FLASH);
					setTimeout(() => el.classList.remove(OUTLINE_FLASH), 1600);
				}
	
				// ---- 数据刷新：会话切换订阅（无轮询，来一条加一条由订阅驱动） ----
				if (sessions.list && sessions.list.subscribe) {
					try { sessions.list.subscribe(() => rebind()); } catch (e) {}
				}
				rebind();
				placeOutline();
				ensureRowObserver();
				rebuildRowMap();
				// ---- 视口跟随：对话区滚动时同步 activeIdx（事件驱动+节流，非轮询；
				//      点跳转已在 scrollToMessage 里直接设 activeIdx） ----
				function syncActiveFromView() {
					const root = findChatRoot();
					const container = root ? findScrollContainer(root) : null;
					if (!container) return;
					const cr = container.getBoundingClientRect();
					if (cr.height <= 0) return;
					// 取对话区左侧偏中的一点做命中检测（避开左缘横杠/留白）
					const x = cr.left + Math.max(80, cr.width * 0.15);
					const y = cr.top + 48;
					const els = document.elementsFromPoint(x, y);
					for (const el of els) {
						const anc = el.closest ? el.closest('[data-chat-anchor-key]') : null;
						const key = anc && anc.getAttribute('data-chat-anchor-key');
						if (!key) continue;
						const idx = userMsgs.findIndex(m => m.key === key);
						if (idx >= 0 && idx !== activeIdx) {
							activeIdx = idx;
							applyActive();
						}
						return;
					}
				}
				{
					const root = findChatRoot();
					const container = root ? findScrollContainer(root) : null;
					if (container) {
						let scrollTmr = null;
						container.addEventListener("scroll", () => {
							if (scrollTmr) return;
							scrollTmr = setTimeout(() => { scrollTmr = null; syncActiveFromView(); }, 300);
						}, { passive: true });
					}
				}
				window.addEventListener("resize", placeOutline);
	
				// ---- 定位高亮动画样式 ----
				if (!document.getElementById("dsh-msg-outline-style")) {
					const st = document.createElement("style");
					st.id = "dsh-msg-outline-style";
					st.textContent = "." + OUTLINE_FLASH + "{animation:dshOutlineFlash 1.6s ease 1}"
						+ "@keyframes dshOutlineFlash{0%,100%{background:transparent}15%,35%{background:rgba(255,200,0,.35)}}";
					document.head.appendChild(st);
				}
	
				document.body.appendChild(box);
			}

		function apply(ctx) {
			buildMessageOutline(ctx);
			// sessions 服务可能晚于本插件注册（cordis 启动顺序），延迟重试一次
			setTimeout(() => buildMessageOutline(ctx), 1500);
		}
		exports.apply = apply;
		exports.inject = ["sessions"];
		return module.exports;
	}
});