export type Perm = 'create' | 'edit' | 'delete' | 'commerce' | 'publish';
export type PolicyValue = Perm | 'public';

// Merkezi route→perm map (fail-closed: map'te olmayan route → 403).
// Key: `${METHOD} ${normalize(ctrlPath, handlerPath)}` — PermissionGuard route metadata'sından üretir.
export const POLICY: Record<string, PolicyValue> = {
  'GET sites': 'public',
  'POST sites': 'create',
  'GET sites/:id': 'public',
  'PUT sites/:id/locales': 'edit',
  'POST builds': 'edit',
  'GET builds': 'public',
  'GET builds/:id': 'public',
  'GET healthz': 'public',
  'GET readyz': 'public',
};

// @Get()/@Post() no-arg handler path '/' → strip → '' → controller only.
// @Get(':id') → ':id', @Put(':id/locales') → ':id/locales'. Leading/trailing slash strip + join.
export function routeKey(method: string, ctrlPath: string, handlerPath: string): string {
  const c = ctrlPath.replace(/^\/+|\/+$/g, '');
  const h = handlerPath.replace(/^\/+|\/+$/g, '');
  const path = h ? (c ? `${c}/${h}` : h) : c;
  return `${method} ${path}`;
}