import { Injectable } from '@angular/core';
import { ApiService } from './api.service';
import { tap } from 'rxjs/operators';
import { environment } from '../../../environments/environment'; // 👈 importante

export interface LoginResponse {
  user: { id: number; email: string; displayName: string };
  accessToken: string;
  refreshToken: string;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  user: LoginResponse['user'] | null = null;
  private baseUrl = environment.apiBaseUrl;  // 👈 usa la URL del back

  constructor(private api: ApiService) {}

  login(email: string, password: string) {
    return this.api
      .post<LoginResponse>(`${this.baseUrl}/auth/login`, { email, password }) // 👈 URL COMPLETA
      .pipe(
        tap(res => {
          this.user = res.user;
          localStorage.setItem('accessToken', res.accessToken);
          localStorage.setItem('refreshToken', res.refreshToken);
        })
      );
  }

  logout() {
    const refreshToken = localStorage.getItem('refreshToken');
    return this.api
      .post<{ ok: boolean }>(`${this.baseUrl}/auth/logout`, { refreshToken }) // 👈 URL COMPLETA
      .pipe(
        tap(() => {
          this.user = null;
          localStorage.removeItem('accessToken');
          localStorage.removeItem('refreshToken');
        })
      );
  }

  isLoggedIn(): boolean {
    return !!localStorage.getItem('accessToken');
  }
}
