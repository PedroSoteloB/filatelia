// src/app/features/auth/reset-password/reset-password.component.ts
import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

@Component({
  selector: 'app-reset-password',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './reset-password.component.html',
  styleUrls: ['./reset-password.component.scss'] // puedes reutilizar el SCSS del forgot
})
export class ResetPasswordComponent implements OnInit {
  token = '';
  password = '';
  confirm = '';
  show = false;
  loading = false;
  msg = '';

  constructor(private route: ActivatedRoute, private router: Router) {}

  ngOnInit(): void {
    this.token = this.route.snapshot.queryParamMap.get('token') ?? '';
  }

  get disabled(): boolean {
    return (
      this.loading ||
      !this.password ||
      this.password !== this.confirm ||
      this.password.length < 8
    );
  }

  async submit() {
    this.loading = true; this.msg = '';
    try {
      const r = await fetch('/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type':'application/json' },
        // 👇 tu backend espera `newPassword`
        body: JSON.stringify({ token: this.token, newPassword: this.password })
      });
      const res = await r.json().catch(() => ({}));
      if (!r.ok) throw res;

      this.msg = 'Contraseña actualizada ✅';
      setTimeout(() => this.router.navigate(['/login']), 1000);
    } catch (e: any) {
      this.msg = e?.message || 'No se pudo actualizar la contraseña';
    } finally {
      this.loading = false;
    }
  }
}
