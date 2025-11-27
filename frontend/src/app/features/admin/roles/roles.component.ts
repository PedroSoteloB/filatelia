import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

// Tipos simples
type Role = { id: number; name: string; description: string | null };
type User = { id: number; email: string; display_name: string };

// Helper para headers con Bearer (siempre mismo shape)
function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  if (typeof window === 'undefined') return headers;
  const t =
    localStorage.getItem('accessToken') ??
    sessionStorage.getItem('accessToken');
  if (t) headers['Authorization'] = `Bearer ${t}`;
  return headers;
}

@Component({
  selector: 'app-admin-roles',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './roles.component.html',
  styleUrls: ['./roles.component.scss']
})
export class AdminRolesComponent implements OnInit {
  // Estado
  loading = false;
  msg = '';

  // Data
  roles: Role[] = [];
  users: User[] = [];
  userRoles: Role[] = [];              // para el panel derecho (usuario seleccionado)

  // Filtros/UI
  q = '';
  editingId: number | null = null;

  // Formularios
  newName = '';
  newDesc = '';
  editName = '';
  editDesc = '';
  selectedUserId: number | null = null;
  selectedRoleId: number | null = null;

  // === NUEVO: Mapa userId -> roles[] (para la tabla Usuarios y roles)
  userRolesMap: Record<number, Role[]> = {};

  async ngOnInit() {
    await this.reloadAll();
  }

  // ------- Carga inicial -------
  async reloadAll() {
    this.loading = true; this.msg = '';
    try {
      await Promise.all([this.fetchRoles(), this.fetchUsers()]);
      await this.fetchAllUserRoles();           // 👈 llena la tabla con roles por usuario
    } catch (e: any) {
      this.msg = e?.message || 'No se pudieron cargar los datos';
    } finally {
      this.loading = false;
    }
  }

  async fetchRoles() {
    const r = await fetch('/roles', { headers: authHeaders() });
    if (!r.ok) throw await r.json();
    this.roles = await r.json();
  }

  async fetchUsers() {
    const r = await fetch('/users', { headers: authHeaders() });
    if (!r.ok) throw await r.json();
    this.users = await r.json();
  }

  async fetchUserRoles(userId: number) {
    const r = await fetch(`/roles/of/${userId}`, { headers: authHeaders() });
    if (!r.ok) throw await r.json();
    this.userRoles = await r.json();
  }

  // ------- CRUD Roles -------
  async createRole() {
    this.msg = '';
    if (!this.newName.trim()) { this.msg = 'Nombre requerido'; return; }
    try {
      const r = await fetch('/roles', {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: this.newName.trim(), description: this.newDesc || null })
      });
      const res = await r.json();
      if (!r.ok) throw res;
      this.roles.push(res);
      this.newName = ''; this.newDesc = '';
      this.msg = 'Rol creado ✅';
    } catch (e: any) {
      this.msg = e?.message || 'No se pudo crear el rol';
    }
  }

  startEdit(role: Role) {
    this.editingId = role.id;
    this.editName = role.name;
    this.editDesc = role.description || '';
  }

  cancelEdit() {
    this.editingId = null; this.editName = ''; this.editDesc = '';
  }

  async saveEdit(roleId: number) {
    this.msg = '';
    try {
      const r = await fetch(`/roles/${roleId}`, {
        method: 'PUT',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: this.editName.trim(), description: this.editDesc || null })
      });
      const res = await r.json();
      if (!r.ok) throw res;

      const idx = this.roles.findIndex(x => x.id === roleId);
      if (idx >= 0) this.roles[idx] = res;

      // reflejar cambios en la tabla (por si cambió el nombre)
      Object.keys(this.userRolesMap).forEach(k => {
        const uid = +k;
        this.userRolesMap[uid] = (this.userRolesMap[uid] || []).map(rr => rr.id === roleId ? res : rr);
      });

      this.cancelEdit();
      this.msg = 'Rol actualizado ✅';
    } catch (e: any) {
      this.msg = e?.message || 'No se pudo actualizar el rol';
    }
  }

  async deleteRole(role: Role) {
    this.msg = '';
    const reserved = ['admin', 'user']; // opcional
    if (reserved.includes(role.name.toLowerCase())) {
      this.msg = 'Rol reservado; no se puede eliminar';
      return;
    }
    if (!confirm(`¿Eliminar el rol "${role.name}"?`)) return;

    try {
      const r = await fetch(`/roles/${role.id}`, {
        method: 'DELETE',
        headers: authHeaders()
      });
      if (!r.ok) throw await r.json();

      this.roles = this.roles.filter(x => x.id !== role.id);
      this.userRoles = this.userRoles.filter(x => x.id !== role.id);

      // quitar de la tabla
      Object.keys(this.userRolesMap).forEach(k => {
        const uid = +k;
        this.userRolesMap[uid] = (this.userRolesMap[uid] || []).filter(rr => rr.id !== role.id);
      });

      this.msg = 'Rol eliminado ✅';
    } catch (e: any) {
      this.msg = e?.message || 'No se pudo eliminar el rol';
    }
  }

  // ------- Asignación (panel derecho) -------
  async onSelectUser() {
    if (this.selectedUserId) {
      try {
        await this.fetchUserRoles(this.selectedUserId);
      } catch (e: any) {
        this.msg = e?.message || 'No se pudieron cargar los roles del usuario';
      }
    } else {
      this.userRoles = [];
    }
  }

  async assignRole() {
    this.msg = '';
    if (!this.selectedUserId || !this.selectedRoleId) {
      this.msg = 'Selecciona usuario y rol';
      return;
    }
    try {
      const r = await fetch('/roles/assign', {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: this.selectedUserId, roleId: this.selectedRoleId })
      });
      const res = await r.json().catch(() => ({}));
      if (!r.ok) throw res;

      await this.fetchUserRoles(this.selectedUserId);
      await this.fetchAndStoreUserRoles(this.selectedUserId); // 👈 refresca la fila en la tabla
      this.msg = 'Rol asignado ✅';
    } catch (e: any) {
      this.msg = e?.message || 'No se pudo asignar el rol';
    }
  }

  async unassignRole(roleId: number) {
    this.msg = '';
    if (!this.selectedUserId) return;
    try {
      const r = await fetch('/roles/unassign', {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: this.selectedUserId, roleId })
      });
      const res = await r.json().catch(() => ({}));
      if (!r.ok) throw res;

      this.userRoles = this.userRoles.filter(rr => rr.id !== roleId);
      await this.fetchAndStoreUserRoles(this.selectedUserId); // 👈 refresca la fila en la tabla
      this.msg = 'Rol desasignado ✅';
    } catch (e: any) {
      this.msg = e?.message || 'No se pudo desasignar el rol';
    }
  }

  // ------- Tabla “Usuarios y roles” -------
  private async fetchAllUserRoles() {
    await Promise.all(this.users.map(u => this.fetchAndStoreUserRoles(u.id)));
  }

  private async fetchAndStoreUserRoles(userId: number) {
    const r = await fetch(`/roles/of/${userId}`, { headers: authHeaders() });
    const data = await r.json();
    if (!r.ok) throw data;
    this.userRolesMap[userId] = data;
  }

  // Devuelve siempre un array (nunca undefined)
  rolesOf(userId: number): Role[] {
    return this.userRolesMap[userId] ?? [];
  }

  // NUEVO: lista legible de roles para el template
  rolesList(userId: number): string {
    const list = this.userRolesMap[userId];
    if (!Array.isArray(list) || list.length === 0) return '';
    return list.map(r => r.name).join(', ');
  }

  // NUEVO: usuarios ordenados por display_name
  get usersSorted(): User[] {
    return [...this.users].sort((a, b) =>
      (a.display_name || '').localeCompare(b.display_name || '', 'es', { sensitivity: 'base' })
    );
  }

  // NUEVO: trackBy para *ngFor
  trackUser(_index: number, u: User): number {
    return u.id;
  }

  // ------- Filtro -------
  get filteredRoles(): Role[] {
    const q = this.q.trim().toLowerCase();
    if (!q) return this.roles;
    return this.roles.filter(r =>
      r.name.toLowerCase().includes(q) ||
      (r.description ?? '').toLowerCase().includes(q)
    );
  }
}
