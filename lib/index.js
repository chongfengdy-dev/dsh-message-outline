// dsh-message-outline 服务端入口：纯前端插件，服务端无逻辑。
// 仅作为 cordis loader entry 存在（client-modules 需要 loader 认识本包才能加载 ./client.js）。
export const name = "dsh-message-outline";

export function apply(ctx) {
	// 无服务端逻辑；前端功能见 ./client.js（左缘消息大纲横杠）
}
