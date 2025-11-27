import { Injectable } from '@angular/core';
import { ApiService } from './api.service';
import { tap } from 'rxjs/operators';

export interface LoginResponse {
  user: { id: number; email: string; displayName: string };
  accessToken: string;
  refreshToken: string;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  user: LoginResponse['user'] | null = null;

  constructor(private api: ApiService) {}

  login(email: string, password: string) {
    return this.api.post<LoginResponse>('/auth/login', { email, password })
      .pipe(tap(res => {
        this.user = res.user;
        localStorage.setItem('accessToken', res.accessToken);
        localStorage.setItem('refreshToken', res.refreshToken);
      }));
  }

  logout() {
    const refreshToken = localStorage.getItem('refreshToken');
    return this.api.post<{ ok: boolean }>('/auth/logout', { refreshToken })
      .pipe(tap(() => {
        this.user = null;
        localStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');
      }));
  }

  isLoggedIn(): boolean {
    return !!localStorage.getItem('accessToken');
  }
}
