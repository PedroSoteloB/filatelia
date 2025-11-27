import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';

@Injectable({ providedIn: 'root' })
export class ApiService {
  constructor(private http: HttpClient) {}
  post<T>(url: string, body: any, headers?: HttpHeaders) {
    return this.http.post<T>(url, body, { headers });
  }
  get<T>(url: string) {
    return this.http.get<T>(url);
  }
}
