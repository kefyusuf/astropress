import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import * as ops from './ops.mjs';
import { getAgent } from './auth.mjs';
import { locales } from './config.mjs';

const server = new McpServer({ name: 'astropress', version: '0.1.0' });
const col = z.enum(['blog', 'products', 'pages']);
const txt = (obj) => ({ content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }] });

// Kimlik: ASTROPRESS_AGENT env (varsayılan content-studio). Yetki matrisi sunucu tarafında zorunlu.
const agent = getAgent();
const P = agent.perms;
// publish yetkisi olan kimlik insan-operatör sayılır (approve/reject kullanabilir); agent'lar kullanamaz.
const KIND = P.publish ? 'human' : 'agent';

// Guardrail: create/update şemalarında `status` YOK. Agent doğrudan yayınlayamaz;
// yayına alma yalnız request_publish -> approve_task (insan, perms.publish) zinciriyle olur.
// price/stock şemada var ama commerce yetkisi sunucuda zorunlu (RBAC).

server.registerTool('whoami', {
  description: 'Bu MCP örneğinin agent kimliğini ve yetki matrisini döndürür.',
  inputSchema: {},
}, async () => txt({ id: agent.id, name: agent.name, perms: P }));

server.registerTool('list_content', {
  description: 'İçerikleri listeler (blog/products/pages). Durum filtresi opsiyonel.',
  inputSchema: { collection: col.optional(), status: z.enum(['draft', 'review', 'published']).optional() },
}, async (args) => txt(ops.list(args)));

server.registerTool('read_content', {
  description: 'Bir içeriğin frontmatter + markdown gövdesini okur.',
  inputSchema: { collection: col, slug: z.string() },
}, async (args) => txt(ops.read(args)));

server.registerTool('create_content', {
  description: 'Yeni içerik oluşturur. Guardrail: durum her zaman "draft"; yayına alma insan onayı gerektirir.',
  inputSchema: { collection: col, title: z.string(), excerpt: z.string().optional(), body: z.string().optional(), author: z.string().optional(), lang: z.enum(locales).optional(), translationOf: z.string().optional() },
}, async (args) => txt(ops.create(args, KIND, P)));

server.registerTool('update_content', {
  description: 'Mevcut içeriği günceller. Guardrail: status değiştirilemez; price/stock commerce yetkisi ister (RBAC).',
  inputSchema: { collection: col, slug: z.string(), title: z.string().optional(), excerpt: z.string().optional(), body: z.string().optional(), seoTitle: z.string().optional(), seoDesc: z.string().optional(), price: z.number().optional(), stock: z.number().optional(), lang: z.enum(locales).optional(), translationOf: z.string().optional() },
}, async (args) => txt(ops.update(args, KIND, P)));

server.registerTool('delete_content', {
  description: 'İçeriği siler (geri alınamaz; audit kaydı tutulur).',
  inputSchema: { collection: col, slug: z.string() },
}, async (args) => txt(ops.remove(args, KIND, P)));

server.registerTool('request_publish', {
  description: 'Yayınlama isteği oluşturur; guardrail gereği insan onayı kuyruğuna düşer.',
  inputSchema: { collection: col, slug: z.string() },
}, async (args) => txt(ops.requestPublish(args, KIND)));

server.registerTool('approve_task', {
  description: 'İNSAN onayı (perms.publish gerektirir): bekleyen yayınlama görevini uygular (status=published).',
  inputSchema: { taskId: z.string() },
}, async (args) => txt(ops.approve(args, KIND, P)));

server.registerTool('reject_task', {
  description: 'İNSAN reddi (perms.publish gerektirir): bekleyen yayınlama görevini reddeder.',
  inputSchema: { taskId: z.string() },
}, async (args) => txt(ops.reject(args, KIND, P)));

server.registerTool('list_tasks', {
  description: 'Görev kuyruğunu listeler (onay bekleyenler dahil).',
  inputSchema: { status: z.enum(['approval', 'done', 'rejected']).optional() },
}, async (args) => txt(ops.tasks(args)));

server.registerTool('run_build', {
  description: 'astro build çalıştırır; statik çıktıyı (dist/) üretir.',
  inputSchema: {},
}, async () => txt(ops.build(KIND)));

server.registerTool('audit_log', {
  description: 'Denetim kaydını (insan + agent eylemleri) döndürür.',
  inputSchema: { limit: z.number().optional() },
}, async (args) => txt(ops.audit(args)));

const transport = new StdioServerTransport();
await server.connect(transport);