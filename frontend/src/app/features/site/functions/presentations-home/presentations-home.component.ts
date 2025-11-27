// import { Component, OnInit, signal, inject } from '@angular/core';
// import { CommonModule } from '@angular/common';
// import {
//   ReactiveFormsModule,
//   FormBuilder,
//   Validators,
//   FormGroup,
//   FormControl
// } from '@angular/forms';
// import { RouterLink } from '@angular/router';
// import { HttpClient, HttpClientModule, HttpHeaders } from '@angular/common/http';

// type Pres = {
//   id: number;
//   title: string;
//   description?: string | null;
//   cover?: string | null;
//   collection_id: number;
//   created_at: string;
//   updated_at: string;
// };

// @Component({
//   selector: 'app-presentations-home',
//   standalone: true,
//   imports: [CommonModule, ReactiveFormsModule, HttpClientModule, RouterLink],
//   templateUrl: './presentations-home.component.html',
//   styleUrls: ['./presentations-home.component.scss'],
// })
// export class PresentationsHomeComponent implements OnInit {

//   private http = inject(HttpClient);
//   private fb   = inject(FormBuilder);

//   loading = signal<boolean>(false);
//   error   = signal<string | null>(null);
//   items   = signal<Pres[]>([]);

//   offset = 0;
//   limit  = 20;
//   hasMore = signal<boolean>(false);
//   showCreate = signal<boolean>(false);

//   // ✅ Form tipado
//   createForm: FormGroup<{
//     collection_id: FormControl<number | null>;
//     title:         FormControl<string>;
//     description:   FormControl<string | null>;
//     cover:         FormControl<File | null>;
//   }> = this.fb.group({
//     collection_id: this.fb.control<number | null>(null, { validators: [Validators.required] }),
//     title:         this.fb.control<string>('', { validators: [Validators.required, Validators.maxLength(180)], nonNullable: true }),
//     description:   this.fb.control<string | null>(null),
//     cover:         this.fb.control<File | null>(null),
//   });

//   // 🔹 Atajo para el template: usar fc.title, fc.collection_id, etc.
//   get fc() { return this.createForm.controls; }

//   ngOnInit(): void { this.load(); }

//   private authHeaders(): HttpHeaders {
//     const token = localStorage.getItem('accessToken') || '';
//     return new HttpHeaders({ Authorization: token ? `Bearer ${token}` : '' });
//   }

//   load(direction: 'init'|'next'|'prev' = 'init') {
//     if (direction === 'next') this.offset += this.limit;
//     if (direction === 'prev') this.offset = Math.max(0, this.offset - this.limit);

//     this.loading.set(true);
//     this.error.set(null);

//     this.http.get<Pres[]>(`/presentations?offset=${this.offset}&limit=${this.limit}`, { headers: this.authHeaders() })
//       .subscribe({
//         next: rows => {
//           this.items.set(rows);
//           this.hasMore.set(rows.length === this.limit);
//           this.loading.set(false);
//         },
//         error: err => {
//           this.error.set(err?.error?.message || 'Http error');
//           this.loading.set(false);
//         }
//       });
//   }

//   toggleCreate() { this.showCreate.set(!this.showCreate()); }

//   onCoverChange(ev: Event) {
//     const input = ev.target as HTMLInputElement;
//     const file = input.files && input.files[0] ? input.files[0] : null;
//     this.fc.cover.setValue(file);
//   }

//   submitCreate() {
//     if (this.createForm.invalid) {
//       this.createForm.markAllAsTouched();
//       return;
//     }

//     // ✅ Tipado a partir del FormGroup
//     const { collection_id, title, description, cover } = this.createForm.getRawValue();

//     let body: any;
//     let headers: HttpHeaders;

//     if (cover instanceof File) {
//       const fd = new FormData();
//       fd.append('metadata', JSON.stringify({ collection_id, title, description }));
//       fd.append('cover', cover);
//       body = fd;
//       headers = this.authHeaders(); // NO seteamos Content-Type; el browser pone multipart
//     } else {
//       body = { collection_id, title, description };
//       headers = this.authHeaders().set('Content-Type', 'application/json');
//     }

//     this.loading.set(true);
//     this.http.post<{ id: number }>(`/presentations`, body, { headers })
//       .subscribe({
//         next: () => {
//           this.loading.set(false);
//           this.showCreate.set(false);
//           this.createForm.reset();
//           this.offset = 0;
//           this.load('init');
//         },
//         error: (err) => {
//           this.loading.set(false);
//           this.error.set(err?.error?.message || 'No se pudo crear la presentación');
//         }
//       });
//   }

//   trackById = (_: number, it: Pres) => it.id;
// }

import { Component, OnInit, signal, inject, Inject } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import {
  ReactiveFormsModule,
  FormBuilder,
  Validators,
  FormGroup,
  FormControl
} from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { HttpClient, HttpClientModule, HttpHeaders } from '@angular/common/http';
import { PLATFORM_ID } from '@angular/core';

/**
 * Coincide con el back
 */
type Pres = {
  id: number;
  title: string;
  description?: string | null;
  cover?: string | null;
  collection_id: number;
  created_at: string;
  updated_at: string;
};

// === Helpers JWT (roles/exp) ===
function getRoleFromToken(token: string): any {
  if (!token) return undefined;
  try {
    const payload = JSON.parse(
      atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))
    );
    return payload.role ?? payload.roles ?? payload.permissions;
  } catch { return undefined; }
}
// ✅ Si no hay `exp`, lo consideramos **no vencido**
function isExpired(token: string): boolean {
  try {
    const { exp } = JSON.parse(atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));
    if (typeof exp !== 'number') return false;
    return Date.now()/1000 >= exp;
  } catch { return false; }
}

@Component({
  selector: 'app-presentations-home',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, HttpClientModule, RouterLink],
  templateUrl: './presentations-home.component.html',
  styleUrls: ['./presentations-home.component.scss'],
})
export class PresentationsHomeComponent implements OnInit {

  private http = inject(HttpClient);
  private fb   = inject(FormBuilder);
  private router = inject(Router);
  constructor(@Inject(PLATFORM_ID) private platformId: Object) {}

  // Auth/UI
  isAuth = false;
  isAdmin = false;
  isBrowser = false;

  loading = signal<boolean>(false);
  error   = signal<string | null>(null);
  items   = signal<Pres[]>([]);

  offset = 0;
  limit  = 20;
  hasMore = signal<boolean>(false);
  showCreate = signal<boolean>(false);

  // ✅ Form tipado
  createForm: FormGroup<{
    collection_id: FormControl<number | null>;
    title:         FormControl<string>;
    description:   FormControl<string | null>;
    cover:         FormControl<File | null>;
  }> = this.fb.group({
    collection_id: this.fb.control<number | null>(null, { validators: [Validators.required] }),
    title:         this.fb.control<string>('', { validators: [Validators.required, Validators.maxLength(180)], nonNullable: true }),
    description:   this.fb.control<string | null>(null),
    cover:         this.fb.control<File | null>(null),
  });

  // 🔹 Atajo para el template: usar fc.title, fc.collection_id, etc.
  get fc() { return this.createForm.controls; }

  ngOnInit(): void {
    // Auth/roles
    this.isBrowser = isPlatformBrowser(this.platformId);
    if (this.isBrowser) {
      const token =
        localStorage.getItem('accessToken') ??
        sessionStorage.getItem('accessToken') ??
        '';

      if (token && !isExpired(token)) {
        this.isAuth = true;
        const role = getRoleFromToken(token);
        this.isAdmin = Array.isArray(role) ? role.includes('admin') : role === 'admin';
      } else {
        // si estaba corrupto o vencido, limpia pero NO fuerces logout si quieres dejar ver la vista
        if (token && isExpired(token)) { localStorage.clear(); sessionStorage.clear(); }
        this.isAuth = false;
        this.isAdmin = false;
        // si esta vista requiere login sí o sí, descomenta:
        // this.goLogin(this.router.url);
        // return;
      }
    }

    this.load();
  }

  // ===== NAV (para header en el template) =====
  goInicio() { this.router.navigateByUrl('/'); }
  goLogin(returnUrl: string = this.router.url) {
    this.router.navigate(['/login'], { queryParams: { returnUrl } });
  }
  private navigateOrLogin(targetUrl: string) {
    if (!this.isAuth) { this.goLogin(targetUrl); return; }
    this.router.navigateByUrl(targetUrl);
  }
  goUpload() { this.navigateOrLogin('/items/upload'); }
  goMyItems() { this.navigateOrLogin('/items/mine'); }
  goSearch() { this.router.navigateByUrl('/items/search'); }
  goCollections() { this.navigateOrLogin('/collections'); }
  goPresentation() { this.navigateOrLogin('/presentations'); }
  logout() {
    if (!this.isBrowser) return;
    const refresh =
      localStorage.getItem('refreshToken') ??
      sessionStorage.getItem('refreshToken');
    fetch('/auth/logout', {
      method: 'POST',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify({ refreshToken: refresh })
    }).catch(() => {});
    localStorage.clear(); sessionStorage.clear();
    this.isAuth = false; this.isAdmin = false;
    this.router.navigate(['/']);
  }

  private authHeaders(): HttpHeaders {
    if (!this.isBrowser) return new HttpHeaders();
    const token =
      localStorage.getItem('accessToken') ||
      sessionStorage.getItem('accessToken') || '';
    return token ? new HttpHeaders({ Authorization: `Bearer ${token}` }) : new HttpHeaders();
  }

  load(direction: 'init'|'next'|'prev' = 'init') {
    if (direction === 'next') this.offset += this.limit;
    if (direction === 'prev') this.offset = Math.max(0, this.offset - this.limit);

    this.loading.set(true);
    this.error.set(null);

    this.http.get<Pres[]>(
      `/presentations?offset=${this.offset}&limit=${this.limit}`,
      { headers: this.authHeaders() }
    ).subscribe({
      next: rows => {
        this.items.set(rows);
        this.hasMore.set(rows.length === this.limit);
        this.loading.set(false);
      },
      error: err => {
        this.error.set(err?.error?.message || 'Http error');
        this.loading.set(false);
      }
    });
  }

  toggleCreate() { this.showCreate.set(!this.showCreate()); }

  onCoverChange(ev: Event) {
    const input = ev.target as HTMLInputElement;
    const file = input.files && input.files[0] ? input.files[0] : null;
    this.fc.cover.setValue(file);
  }

  submitCreate() {
    if (this.createForm.invalid) {
      this.createForm.markAllAsTouched();
      return;
    }

    // ✅ Tipado a partir del FormGroup
    const { collection_id, title, description, cover } = this.createForm.getRawValue();

    let body: any;
    let headers: HttpHeaders;

    if (cover instanceof File) {
      const fd = new FormData();
      fd.append('metadata', JSON.stringify({ collection_id, title, description }));
      fd.append('cover', cover);
      body = fd;
      headers = this.authHeaders(); // el browser setea el boundary
    } else {
      body = { collection_id, title, description };
      headers = this.authHeaders().set('Content-Type', 'application/json');
    }

    this.loading.set(true);
    this.http.post<{ id: number }>(`/presentations`, body, { headers })
      .subscribe({
        next: () => {
          this.loading.set(false);
          this.showCreate.set(false);
          this.createForm.reset();
          this.offset = 0;
          this.load('init');
        },
        error: (err) => {
          this.loading.set(false);
          this.error.set(err?.error?.message || 'No se pudo crear la presentación');
        }
      });
  }

  trackById = (_: number, it: Pres) => it.id;
}
