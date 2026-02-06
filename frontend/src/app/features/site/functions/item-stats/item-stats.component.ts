import { Component, ViewEncapsulation, Inject, OnInit, inject, signal } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { RouterModule } from '@angular/router';
import { HttpClient, HttpClientModule, HttpHeaders } from '@angular/common/http';
import { PLATFORM_ID } from '@angular/core';

import { environment } from '../../../../core/environments/environment.prod';

const API_BASE = environment.apiBaseUrl;

type StatPair = { key: string; count: number };

type CountryPriceRow = {
  country: string | null;
  count: number;
  totalValue: number | null;
  avgValue: number | null;
  minValue: number | null;
  maxValue: number | null;
};

type ItemStatsResponse = {
  total: number;
  byType: StatPair[];
  byCondition: StatPair[];
  byCountryPrice: CountryPriceRow[];
};

function errorMessage(err: any, fallback: string) {
  return err?.error?.message ?? (typeof err?.message === 'string' ? err.message : null) ?? fallback;
}

@Component({
  selector: 'app-item-stats',
  standalone: true,
  imports: [CommonModule, RouterModule, HttpClientModule],
  templateUrl: './item-stats.component.html',
  styleUrl: './item-stats.component.scss',
  encapsulation: ViewEncapsulation.None,
  host: { class: 'search-page' },
})
export class ItemStatsComponent implements OnInit {
  private http = inject(HttpClient);
  @Inject(PLATFORM_ID) private platformId: Object = inject(PLATFORM_ID);

  isBrowser = false;

  busy = signal(false);
  error = signal<string | null>(null);
  stats = signal<ItemStatsResponse | null>(null);

  topN = 10;

  ngOnInit(): void {
    this.isBrowser = isPlatformBrowser(this.platformId);
    this.fetchStats();
  }

  private buildHeaders(): HttpHeaders {
    if (!this.isBrowser) return new HttpHeaders();

    const token = localStorage.getItem('accessToken') || sessionStorage.getItem('accessToken') || '';
    return token ? new HttpHeaders({ Authorization: `Bearer ${token}` }) : new HttpHeaders();
  }

  fetchStats() {
    this.busy.set(true);
    this.error.set(null);

    this.http.get<ItemStatsResponse>(`${API_BASE}/me/items/stats`, { headers: this.buildHeaders() }).subscribe({
      next: (res) => {
        const safe: ItemStatsResponse = {
          total: Number(res?.total ?? 0),
          byType: Array.isArray(res?.byType) ? res.byType : [],
          byCondition: Array.isArray(res?.byCondition) ? res.byCondition : [],
          byCountryPrice: Array.isArray(res?.byCountryPrice) ? res.byCountryPrice : [],
        };

        this.stats.set(safe);
        this.busy.set(false);
      },
      error: (err) => {
        this.error.set(errorMessage(err, 'No se pudo cargar el dashboard.'));
        this.busy.set(false);
      },
    });
  }

  // ===== Helpers UI =====

  takeTop(list: StatPair[] | undefined): StatPair[] {
    const arr = Array.isArray(list) ? [...list] : [];
    arr.sort((a, b) => Number(b?.count ?? 0) - Number(a?.count ?? 0));
    return arr.slice(0, this.topN);
  }

  maxCount(list: StatPair[] | undefined): number {
    const arr = Array.isArray(list) ? list : [];
    let m = 0;
    for (const r of arr) m = Math.max(m, Number(r?.count ?? 0));
    return m || 1;
  }

  // Donut / porcentajes
  pct(a: any, b: any): number {
    const A = Number(a ?? 0);
    const B = Number(b ?? 0);
    if (!Number.isFinite(A) || !Number.isFinite(B) || B <= 0) return 0;
    const p = (A / B) * 100;
    return Math.max(0, Math.min(100, Math.round(p)));
  }

  sumCount(list: StatPair[] | undefined): number {
    const arr = Array.isArray(list) ? list : [];
    let s = 0;
    for (const r of arr) s += Number(r?.count ?? 0);
    return s;
  }

  // Países (barras verticales)
  takeTopCountry(list: CountryPriceRow[] | undefined): CountryPriceRow[] {
    const arr = Array.isArray(list) ? [...list] : [];
    arr.sort((a, b) => Number(b?.count ?? 0) - Number(a?.count ?? 0));
    return arr.slice(0, this.topN);
  }

  maxCountryCount(list: CountryPriceRow[] | undefined): number {
    const arr = Array.isArray(list) ? list : [];
    let m = 0;
    for (const r of arr) m = Math.max(m, Number(r?.count ?? 0));
    return m || 1;
  }

  // Gauge (concentración de valor)
  sumCountryTotal(list: CountryPriceRow[] | undefined): number {
    const arr = Array.isArray(list) ? list : [];
    let s = 0;
    for (const r of arr) {
      const v = Number(r?.totalValue ?? 0);
      if (Number.isFinite(v)) s += v;
    }
    return s;
  }

  topCountryByTotal(list: CountryPriceRow[] | undefined): CountryPriceRow | null {
    const arr = Array.isArray(list) ? list : [];
    if (!arr.length) return null;

    let best: CountryPriceRow | null = null;
    let bestV = -Infinity;

    for (const r of arr) {
      const v = Number(r?.totalValue ?? 0);
      const vv = Number.isFinite(v) ? v : 0;
      if (best === null || vv > bestV) {
        best = r;
        bestV = vv;
      }
    }
    return best;
  }

  // Misc UI
  short(text: any, n: number): string {
    const s = String(text ?? '').trim();
    const max = Math.max(0, Number(n ?? 0));
    if (!s) return '—';
    if (!max) return '';
    return s.length > max ? s.slice(0, max - 1) + '…' : s;
  }

  barWidth(count: number, max: number): string {
    const c = Number(count ?? 0);
    const m = Number(max ?? 1);
    const pct = Math.max(0, Math.min(100, (c / m) * 100));
    return `${pct}%`;
  }

  fmtMoney(n: any): string {
    if (n === null || n === undefined || n === '') return '—';
    const v = Number(n);
    if (!Number.isFinite(v)) return '—';
    return v.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  fmtText(v: any): string {
    const s = String(v ?? '').trim();
    return s ? s : '—';
  }
}
