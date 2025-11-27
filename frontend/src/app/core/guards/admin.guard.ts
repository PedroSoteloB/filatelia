import { inject } from '@angular/core';
import { CanMatchFn, Router } from '@angular/router';
import { PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

export const adminGuard: CanMatchFn = () => {
  const router = inject(Router);
  const platformId = inject(PLATFORM_ID);

  // En SSR no hay Web Storage: deja pasar y el cliente re-evalúa.
  if (!isPlatformBrowser(platformId)) return true;

  const token =
    localStorage.getItem('accessToken') ??
    sessionStorage.getItem('accessToken');

  const ok = isAdminFromToken(token);
  // ✅ Devolver UrlTree en lugar de navegar
  return ok ? true : router.parseUrl('/');
};

function isAdminFromToken(token: string | null): boolean {
  if (!token) return false;
  try {
    const payload = JSON.parse(
      atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))
    );

    // ⏰ Exp expirado → no permitir
    if (payload?.exp && Math.floor(Date.now() / 1000) >= payload.exp) {
      return false;
    }

    const roles = payload?.roles ?? payload?.role ?? payload?.permissions;
    if (roles === 'admin') return true;
    if (Array.isArray(roles) && roles.includes('admin')) return true;

    // Fallback por email (hasta que todos los JWT incluyan roles)
    const email = (payload?.email ?? '').toLowerCase();
    return email === 'admin@local.test';
  } catch {
    return false;
  }
}
