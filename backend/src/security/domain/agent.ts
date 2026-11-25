export interface Perms {
  create: boolean;
  edit: boolean;
  delete: boolean;
  commerce: boolean;
  publish: boolean;
}

export interface Agent {
  id: string;
  name: string;
  perms: Perms;
}